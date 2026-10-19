// Sending a round's results to the computer with no file: scan the code on the computer's screen, then show the
// phone's reply code to the computer's webcam. If the two can connect over Wi-Fi, everything goes straight across at
// full size; if the network keeps them apart, the phone flashes the results as a stream of codes the webcam reads –
// the readings first, then the photos (made smaller so they go quickly).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Group, Loader, Progress, SegmentedControl, Stack, Switch, Text } from '@mantine/core';
import { IconArrowLeft, IconCheck, IconPlayerStop, IconWifi } from '@tabler/icons-react';
import type { FieldResults } from './model';
import { getPref, setPref } from './db';
import { CodeStream, QrCode } from './link/QrCode';
import { openCamera, scanVideo, stopCamera } from './link/scan';
import { answerLink, opened } from './link/rtc';
import { packCode, unpackCode, type LinkCode } from './link/signal';
import { CODE } from './link/codec';
import { photosOf, type LinkPhoto } from './link/payload';
import { CODE_SIZES, FrameSchedule, prepare, sendOverLink, type CodeSize, type Outgoing } from './link/transfer';

type Phase = 'scan' | 'joining' | 'answer' | 'link' | 'stream' | 'sent';

/** Photos made smaller for the flashing code: 1024 px across at most, WebP where the phone makes it (else JPEG). */
async function smallerPhotos(results: FieldResults): Promise<LinkPhoto[]> {
  const out: LinkPhoto[] = [];
  for (const v of results.visits)
    for (const p of v.photos ?? []) {
      try {
        const img = new Image();
        img.src = p.dataUrl;
        await img.decode();
        const scale = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        const blob = (await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.6))) ?? null;
        const use = blob?.type === 'image/webp' ? blob : await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.65));
        if (use) out.push({ siteId: v.siteId, name: p.name.replace(/\.\w+$/, '') + (use.type === 'image/webp' ? '.webp' : '.jpg'), type: use.type, bytes: new Uint8Array(await use.arrayBuffer()) });
      } catch {
        const full = photosOf({ ...results, visits: [{ ...v, photos: [p] }] })[0];
        if (full) out.push(full);
      }
    }
  return out;
}

const sizeText = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const timeText = (s: number) => (s < 60 ? `${Math.max(1, Math.round(s))} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`);

/** Keeps the screen on while the codes are showing. */
function useScreenOn(on: boolean) {
  useEffect(() => {
    if (!on) return;
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    void nav.wakeLock
      ?.request('screen')
      .then((l) => (lock = l))
      .catch(() => undefined);
    return () => void lock?.release().catch(() => undefined);
  }, [on]);
}

export function LinkPage({ results, onSent, onCancel }: { results: FieldResults; onSent: () => void; onCancel: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>('scan');
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<Uint8Array | null>(null);
  const [small, setSmall] = useState<Outgoing | null>(null);
  const [full, setFull] = useState<Outgoing | null>(null);
  const [sent, setSent] = useState(0);
  const [size, setSize] = useState<CodeSize>('medium');
  const [slow, setSlow] = useState(false);
  const [started, setStarted] = useState(0);
  const [, tick] = useState(0);
  // where the Wi-Fi link didn't connect last time (an office network), the code starts flashing sooner
  const [wifiFailedBefore, setWifiFailedBefore] = useState(false);
  useEffect(() => void getPref('wifiLink').then((v) => setWifiFailedBefore(v === 'failed')), []);
  useScreenOn(phase === 'answer' || phase === 'stream' || phase === 'link');

  // 1. scan the computer's code
  useEffect(() => {
    if (phase !== 'scan') return;
    let live = true;
    let joining = false;
    let stream: MediaStream | null = null;
    let stop: (() => void) | null = null;
    (async () => {
      try {
        stream = await openCamera('environment');
        if (!live) return stopCamera(stream);
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play().catch(() => undefined);
        stop = scanVideo(video, async (bytes) => {
          if (!live || bytes[0] !== CODE.offer) return;
          let offer: LinkCode;
          try {
            offer = unpackCode(bytes);
          } catch {
            return;
          }
          live = false;
          joining = true;
          stop?.();
          setPhase('joining');
          try {
            // joined while the camera is still on (the browser then uses the phone's real local address)
            const link = await answerLink(offer);
            stopCamera(stream);
            setAnswer(packCode(link.code));
            setPhase('answer');
            setStarted(Date.now());
            const key = offer.key!;
            const [whole, smaller] = await Promise.all([prepare(results, offer.session, key), smallerPhotos(results).then((p) => prepare(results, offer.session, key, p))]);
            setFull(whole);
            setSmall(smaller);
            // 2a. straight over Wi-Fi, when it connects
            void link.channel
              .then(async (channel) => {
                await opened(channel);
                void setPref('wifiLink', 'ok');
                setPhase('link');
                await sendOverLink(channel, whole, setSent);
                setPhase('sent');
                onSent();
              })
              .catch((e) => setError((e as Error).message));
          } catch (e) {
            stopCamera(stream);
            setError((e as Error).message);
          }
        });
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    })();
    return () => {
      live = false;
      stop?.();
      // when joining, the camera stays on until the phone has its reply code
      if (!joining) stopCamera(stream);
    };
  }, [phase === 'scan']); // eslint-disable-line react-hooks/exhaustive-deps

  // 2b. no Wi-Fi link after a few seconds: flash the results instead
  useEffect(() => {
    if (phase !== 'answer' || !small) return;
    const t = setTimeout(
      () =>
        setPhase((p) => {
          if (p !== 'answer') return p;
          void setPref('wifiLink', 'failed');
          return 'stream';
        }),
      Math.max(0, (wifiFailedBefore ? 3000 : 10_000) - (Date.now() - started)),
    );
    return () => clearTimeout(t);
  }, [phase, small, started, wifiFailedBefore]);
  useEffect(() => {
    if (phase !== 'stream') return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const schedule = useMemo(() => (small ? new FrameSchedule(small, size, answer) : null), [small, size, answer]);
  const perSecond = slow ? 5 : 12;

  return (
    <Stack gap="sm">
      {error && (
        <Alert color="red" variant="light" title="Not sent">
          <Text size="sm">{error}</Text>
          <Text size="sm" mt={4}>
            Try again, or go back and send the results as a file.
          </Text>
        </Alert>
      )}
      {phase === 'scan' && (
        <>
          <Text size="sm">
            On the computer, open the project and choose <b>⋯ → Receive from a phone</b>. Point this camera at the code it shows.
          </Text>
          <video ref={videoRef} muted playsInline aria-label="This phone’s camera" style={{ width: '100%', borderRadius: 8, background: '#000', aspectRatio: '3 / 4', objectFit: 'cover' }} />
        </>
      )}
      {phase === 'joining' && (
        <Group gap="xs">
          <Loader size="sm" />
          <Text size="sm">Got it – getting ready…</Text>
        </Group>
      )}
      {phase === 'answer' && answer && (
        <>
          <Text fw={600}>Now turn the phone round and hold this up to the computer’s camera</Text>
          <QrCode bytes={answer} size="100%" label="This phone’s reply code" />
          <Group gap="xs">
            <Loader size="xs" />
            <Text size="sm" c="dimmed">
              Connecting over Wi-Fi… if it can’t, the code starts flashing the results by itself.
            </Text>
          </Group>
        </>
      )}
      {phase === 'link' && full && (
        <>
          <Group gap="xs">
            <IconWifi size={18} color="var(--mantine-color-teal-6)" />
            <Text size="sm">Connected over Wi-Fi – sending everything at full size ({sizeText(full.readings.length + (full.photos?.length ?? 0))}).</Text>
          </Group>
          <Progress value={sent * 100} />
        </>
      )}
      {phase === 'stream' && schedule && small && (
        <>
          <Text size="sm" fw={600}>
            Keep it steady in front of the computer’s camera until the computer shows a tick.
          </Text>
          <CodeStream next={() => schedule.next()} perSecond={perSecond} version={CODE_SIZES[size].version} running />
          <Text size="xs" c="dimmed">
            The Wi-Fi link couldn’t connect, so the results go across as a flashing code: the readings first (a second or two), then {small.photoCount ? `${small.photoCount} photos, made smaller (${sizeText(small.photos?.length ?? 0)})` : 'that’s all'}. About{' '}
            {timeText(schedule.needed / perSecond / 0.7)} in all; {timeText((Date.now() - started) / 1000)} so far.
          </Text>
          <Group justify="space-between" wrap="wrap" gap="xs">
            <SegmentedControl
              size="xs"
              value={size}
              onChange={(v) => setSize(v as CodeSize)}
              data={[
                { value: 'small', label: 'Small code' },
                { value: 'medium', label: 'Medium' },
                { value: 'large', label: 'Large' },
              ]}
            />
            <Switch size="sm" label="Slow" checked={slow} onChange={(e) => setSlow(e.currentTarget.checked)} />
          </Group>
          <Text size="xs" c="dimmed">
            Larger codes are quicker if the computer reads them; if it struggles, try smaller (that starts the photos again). The code flickers – look away if flashing bothers you; Slow is gentler.
          </Text>
          <Button
            leftSection={<IconCheck size={16} />}
            onClick={() => {
              setPhase('sent');
              onSent();
            }}
          >
            The computer has it – finish
          </Button>
        </>
      )}
      {phase === 'sent' && (
        <Alert color="teal" icon={<IconCheck size={18} />} title="Sent">
          <Text size="sm">The computer has the results. Check them there and add them to the project.</Text>
        </Alert>
      )}
      {phase !== 'sent' && (
        <Button variant="subtle" color="gray" onClick={onCancel} leftSection={phase === 'scan' ? <IconArrowLeft size={16} /> : <IconPlayerStop size={16} />}>
          {phase === 'scan' ? 'Back' : 'Stop'}
        </Button>
      )}
    </Stack>
  );
}


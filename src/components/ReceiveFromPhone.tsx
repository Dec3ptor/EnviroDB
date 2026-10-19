// Receiving a phone's field results on the computer, with no file to save or upload: the computer shows a code, the
// phone scans it and shows its reply to the webcam. Then the two connect straight over Wi-Fi – or, where the network
// keeps devices apart (as office networks often do), the phone flashes the results as a stream of codes the webcam
// reads. Either way the results are sealed with a key that was only ever on this screen.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Badge, Button, Grid, Group, Loader, Modal, Progress, Stack, Text } from '@mantine/core';
import { IconCheck, IconDeviceMobile, IconPlugConnected, IconQrcode, IconWifi } from '@tabler/icons-react';
import { QrCode } from '../field/link/QrCode';
import { openCamera, scanVideo, stopCamera } from '../field/link/scan';
import { completeLink, offerLink, opened } from '../field/link/rtc';
import { packCode, unpackCode } from '../field/link/signal';
import { newKey, STREAM } from '../field/link/payload';
import { Receiver, type Received } from '../field/link/transfer';
import type { FieldResults } from '../field/model';

type Phase = 'starting' | 'waiting' | 'connecting' | 'link' | 'camera' | 'failed';

const OLDER_CODE = 'The phone is sending for an older code. On the phone, tap Stop, then Send to the computer again and scan the code on this screen.';

export function ReceiveFromPhone({ opened: isOpen, onClose, onReceived }: { opened: boolean; onClose: () => void; onReceived: (results: FieldResults, name: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>('starting');
  const [error, setError] = useState<string | null>(null);
  const [offer, setOffer] = useState<Uint8Array | null>(null);
  const [got, setGot] = useState<Received | null>(null);
  const [progress, setProgress] = useState({ link: 0, readings: 0, photos: 0 });
  const [rate, setRate] = useState(0);
  const [wifiBlocked, setWifiBlocked] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const finish = useRef<(r: Received) => void>(() => undefined);

  const name = (r: Received) => `Phone – ${r.results.sheet.project.code || r.results.sheet.project.name} – ${r.results.sheet.date}`;
  finish.current = (r: Received) => {
    onReceived(r.results, name(r));
    onClose();
  };

  useEffect(() => {
    if (!isOpen) return;
    let live = true;
    let stream: MediaStream | null = null;
    let stopScan: (() => void) | null = null;
    let pc: RTCPeerConnection | null = null;
    let answered = false;
    let blockedTimer = 0;
    setPhase('starting');
    setError(null);
    setOffer(null);
    setGot(null);
    setProgress({ link: 0, readings: 0, photos: 0 });
    setWifiBlocked(false);
    setProblem(null);
    (async () => {
      try {
        // the camera first: while it's on, the browser gives the link its real local address
        stream = await openCamera('user');
        if (!live) return stopCamera(stream);
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play().catch(() => undefined);
        const session = crypto.getRandomValues(new Uint32Array(1))[0];
        const key = await newKey();
        const showProgress = (receiver: Receiver) => {
          const a = receiver.stream.progress(STREAM.readings);
          const b = receiver.stream.progress(STREAM.photos);
          setProgress({ link: receiver.linkProgress, readings: a ? a.solved / a.K : 0, photos: b ? b.solved / b.K : 0 });
        };
        const receiver = new Receiver(session, key, (r, how) => {
          if (!live) return;
          if (how.error) setProblem(how.error);
          setGot(r);
          showProgress(receiver);
          if (r && receiver.complete) setTimeout(() => live && finish.current(r), 600);
        });
        const link = await offerLink(session, key);
        pc = link.pc;
        if (!live) return pc.close();
        link.channel.addEventListener('message', (e) => {
          void receiver.message(e.data as string | ArrayBuffer).then((reply) => {
            if (reply && link.channel.readyState === 'open') link.channel.send(reply);
          });
        });
        void opened(link.channel)
          .then(() => {
            if (!live) return;
            window.clearTimeout(blockedTimer);
            setWifiBlocked(false);
            setPhase('link');
          })
          .catch(() => undefined);
        setOffer(packCode(link.code));
        setPhase('waiting');
        stopScan = scanVideo(
          video,
          async (bytes) => {
            if (!live) return;
            try {
              const kind = await receiver.code(bytes);
              if (kind === 'answer' && !answered) {
                const answer = unpackCode(bytes);
                if (answer.session !== session) return;
                answered = true;
                setPhase((p) => (p === 'waiting' ? 'connecting' : p));
                await completeLink(link.pc, answer);
                blockedTimer = window.setTimeout(() => {
                  if (!live || link.channel.readyState === 'open') return;
                  setWifiBlocked(true);
                }, 9000);
              } else if (kind === 'frame') {
                setPhase((p) => (p === 'link' ? p : 'camera'));
                setProblem((x) => (x === OLDER_CODE ? null : x));
              } else if (kind === 'other') setProblem(OLDER_CODE);
            } catch (e) {
              setProblem((e as Error).message);
            }
          },
          (n) => live && setRate(n),
        );
      } catch (e) {
        if (live) {
          setError((e as Error).message);
          setPhase('failed');
        }
      }
    })();
    return () => {
      live = false;
      window.clearTimeout(blockedTimer);
      stopScan?.();
      stopCamera(stream);
      pc?.close();
    };
  }, [isOpen]);

  const photosWaiting = got && got.photoCount > 0 && !got.photos;
  return (
    <Modal opened={isOpen} onClose={onClose} title="Receive from a phone" size="xl">
      {phase === 'failed' ? (
        <Alert color="orange" title="The camera isn’t available">
          <Text size="sm">{error}</Text>
          <Text size="sm" mt="xs">
            Without a camera, send the results as a file instead: on the phone, <b>Send the results → Send as a file</b>, then drop it on the Import page or save it to the team’s Inbox folder.
          </Text>
        </Alert>
      ) : (
        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, sm: 5 }}>
            <Stack gap="xs" align="center">
              {offer ? <QrCode bytes={offer} size="100%" label="Code for the phone to scan" /> : <Loader my={80} />}
              <Text size="sm">
                <b>1.</b> On the phone, open the round in EnviroDB field and tap <b>Send the results → Send to the computer</b>, then scan this code.
              </Text>
            </Stack>
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 7 }}>
            <Stack gap="xs">
              <div style={{ position: 'relative', background: '#000', borderRadius: 8, overflow: 'hidden', aspectRatio: '16 / 9' }}>
                <video ref={videoRef} muted playsInline aria-label="This computer’s camera" style={{ width: '100%', height: '100%', objectFit: 'contain', transform: 'scaleX(-1)' }} />
                {rate > 0 && (
                  <Badge pos="absolute" top={8} right={8} variant="filled" color="dark">
                    {rate} codes a second
                  </Badge>
                )}
              </div>
              <Text size="sm">
                <b>2.</b> Then hold the phone’s screen up to this camera, about 20–30 cm away.
              </Text>
              <Status phase={phase} wifiBlocked={wifiBlocked} />
              {(phase === 'link' || phase === 'camera' || got) && (
                <Stack gap={6}>
                  {phase === 'link' ? (
                    <Bar label="Results" value={got && !photosWaiting ? 1 : progress.link} />
                  ) : (
                    <>
                      <Bar label="Readings" value={got ? 1 : progress.readings} />
                      {(!got || got.photoCount > 0) && <Bar label={got ? `${got.photoCount} photos` : 'Photos'} value={got?.photos ? 1 : progress.photos} />}
                    </>
                  )}
                </Stack>
              )}
              {problem && (
                <Alert color="red" variant="light" p="xs">
                  <Text size="sm">{problem}</Text>
                </Alert>
              )}
              {got && photosWaiting && (
                <Group justify="flex-end">
                  <Button variant="default" onClick={() => finish.current(got)}>
                    Add now, without the photos
                  </Button>
                </Group>
              )}
            </Stack>
          </Grid.Col>
        </Grid>
      )}
    </Modal>
  );
}

function Bar({ label, value }: { label: string; value: number }) {
  const done = value >= 1;
  return (
    <div>
      <Group justify="space-between" gap="xs">
        <Text size="xs">{label}</Text>
        <Text size="xs" c={done ? 'teal' : 'dimmed'}>
          {done ? (
            <>
              <IconCheck size={12} style={{ verticalAlign: -2 }} /> received
            </>
          ) : (
            `${Math.floor(value * 100)}%`
          )}
        </Text>
      </Group>
      <Progress value={value * 100} color={done ? 'teal' : undefined} size="sm" />
    </div>
  );
}

function Status({ phase, wifiBlocked }: { phase: Phase; wifiBlocked: boolean }) {
  const line = (icon: ReactNode, text: ReactNode) => (
    <Group gap={6} wrap="nowrap" align="flex-start">
      {icon}
      <Text size="sm">{text}</Text>
    </Group>
  );
  if (phase === 'starting') return line(<Loader size={14} />, 'Starting the camera…');
  if (phase === 'waiting') return line(<IconDeviceMobile size={18} />, 'Waiting for the phone…');
  if (phase === 'link') return line(<IconWifi size={18} color="var(--mantine-color-teal-6)" />, 'Connected straight over Wi-Fi – receiving everything at full size.');
  if (phase === 'camera')
    return line(<IconQrcode size={18} />, wifiBlocked ? 'The Wi-Fi link couldn’t connect here, so the phone is flashing the results – keep it steady in front of the camera.' : 'Reading the phone’s flashing code – keep it steady in front of the camera.');
  return line(<IconPlugConnected size={18} />, wifiBlocked ? 'The Wi-Fi link couldn’t connect here (the network keeps devices apart). The phone switches to a flashing code by itself – keep it in front of the camera.' : 'Phone found – connecting over Wi-Fi…');
}

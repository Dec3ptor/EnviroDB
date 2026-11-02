// A project's file, shown in EnviroDB: a PDF's pages, a picture, a text file's text – anything else to download and
// open in its own program. It sits over the page (in a sample's details too: Escape closes only it).

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionIcon, Alert, Badge, Button, Center, Group, Loader, Portal, Stack, Text } from '@mantine/core';
import { IconDownload, IconFile, IconFileSpreadsheet, IconFileText, IconFileTypePdf, IconFileZip, IconFolder, IconFolderOpen, IconPhoto, IconWorld, IconX } from '@tabler/icons-react';
import type { ProjectFile } from '../db/types';
import { downloadBlob } from '../db/backup';
import { PdfPreview } from '../reports/PdfPreview';
import { fileSize, insideProjectsFolder, kindLabel, sharedCopy, webAddress } from '../lib/projectFiles';
import { allowProjectsRoot, connectProjectsRoot, openProjectsFolder, useInbox } from '../sync/inbox';

/** A file's icon: by its type, or a link's kind. */
export function FileIcon({ f, size = 18 }: { f: Pick<ProjectFile, 'name' | 'href' | 'path'>; size?: number }) {
  if (f.href) return webAddress(f.href) ? <IconWorld size={size} color="var(--mantine-color-blue-6)" /> : <IconFolder size={size} color="var(--mantine-color-yellow-7)" />;
  const n = f.name.toLowerCase();
  if (n.endsWith('.pdf')) return <IconFileTypePdf size={size} color="var(--mantine-color-red-6)" />;
  if (/\.(xlsx|xlsm|xls|csv|tsv|ods)$/.test(n)) return <IconFileSpreadsheet size={size} color="var(--mantine-color-green-7)" />;
  if (/\.(png|jpe?g|gif|webp|heic|bmp|svg)$/.test(n)) return <IconPhoto size={size} color="var(--mantine-color-violet-6)" />;
  if (/\.(docx?|txt|rtf|odt|msg|eml|md)$/.test(n)) return <IconFileText size={size} color="var(--mantine-color-blue-7)" />;
  if (/\.(zip|7z|rar)$/.test(n)) return <IconFileZip size={size} />;
  return <IconFile size={size} />;
}

type Shown = 'pdf' | 'image' | 'text' | 'other';

/** How a file is shown here, by its name (or type). */
export function shownAs(name: string, type?: string): Shown {
  if (/\.pdf$/i.test(name) || type === 'application/pdf') return 'pdf';
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name) || type?.startsWith('image/')) return 'image';
  if (/\.(txt|csv|tsv|json|md|log|xml)$/i.test(name) || type?.startsWith('text/')) return 'text';
  return 'other';
}

/** The file itself: its copy in the shared folder, or – a path through the projects folder – from there. */
export async function readFile(f: ProjectFile): Promise<{ file: File | null; why?: 'missing' | 'no-folder' | 'elsewhere' }> {
  if (f.path) {
    const file = await sharedCopy(f);
    return file ? { file } : { file: null, why: 'missing' };
  }
  if (!f.href || webAddress(f.href)) return { file: null, why: 'elsewhere' };
  const open = openProjectsFolder();
  if (!open) return { file: null, why: 'no-folder' };
  const inside = insideProjectsFolder(f.href, open.name);
  if (!inside) return { file: null, why: 'elsewhere' };
  const file = await open.folder.file(inside).catch(() => null);
  return file ? { file } : { file: null, why: 'missing' };
}

/** The file over the page; `onClose` when done. */
export function FileViewer({ file: f, onClose }: { file: ProjectFile; onClose: () => void }) {
  const [state, setState] = useState<{ file: File | null; why?: string; text?: string; url?: string } | null>(null);
  const [tries, setTries] = useState(0);
  const inbox = useInbox();
  const how = shownAs(f.name, f.type);
  // focus in the file (for the keyboard and screen readers)
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => box.current?.focus(), []);
  useEffect(() => {
    let cancelled = false;
    let url: string | undefined;
    setState(null);
    void (async () => {
      const got = await readFile(f);
      if (cancelled || !got.file) return void (!cancelled && setState({ file: null, why: got.why }));
      const kind = shownAs(f.name, got.file.type || f.type);
      const text = kind === 'text' ? await got.file.slice(0, 300 * 1024).text() : undefined;
      if (kind === 'image') url = URL.createObjectURL(got.file);
      if (!cancelled) setState({ file: got.file, text, url });
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [f.id, f.path, f.href, tries, inbox.root.access]);
  // Escape closes the file only – not a drawer it was opened from (both listen on the window; this runs first)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  // a new reader each time (the PDF reader takes the bytes it's given)
  const load = useCallback(async () => new Uint8Array(await state!.file!.arrayBuffer()), [state?.file]);
  const save = () => state?.file && downloadBlob(state.file, f.name);
  return (
    <Portal>
      <div
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={f.name}
        data-mantine-stop-propagation="true"
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.6)', display: 'grid', placeItems: 'center', outline: 'none' }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ width: 'min(1100px, 96vw)', height: '92vh', background: 'var(--mantine-color-body)', borderRadius: 8, display: 'flex', flexDirection: 'column', padding: 12, gap: 8, boxShadow: 'var(--mantine-shadow-xl)' }}
        >
          <Group justify="space-between" wrap="nowrap" gap="xs">
            <Stack gap={0} style={{ minWidth: 0 }}>
              <Text fw={600} truncate="end">
                {f.name}
              </Text>
              <Group gap={6}>
                <Badge size="xs" variant="light">
                  {kindLabel(f.kind)}
                </Badge>
                <Text size="xs" c="dimmed">
                  {[f.lab, f.ref, fileSize(state?.file?.size ?? f.size)].filter(Boolean).join(' · ')}
                </Text>
              </Group>
            </Stack>
            <Group gap={6} wrap="nowrap">
              {state?.file && (
                <Button size="xs" variant="default" leftSection={<IconDownload size={14} />} onClick={save}>
                  Download
                </Button>
              )}
              <ActionIcon variant="subtle" color="gray" onClick={onClose} aria-label="Close">
                <IconX size={18} />
              </ActionIcon>
            </Group>
          </Group>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: how === 'pdf' ? 'hidden' : 'auto' }}>
            {!state ? (
              <Center h="100%">
                <Loader />
              </Center>
            ) : !state.file ? (
              <Center h="100%">
                <Stack align="center" gap="xs" maw={460}>
                  {state.why === 'no-folder' && inbox.root.access === 'prompt' ? (
                    <>
                      <Text size="sm" ta="center">
                        It’s in your projects folder ({inbox.root.name}). After the browser restarts it asks once before EnviroDB can open files there.
                      </Text>
                      <Button leftSection={<IconFolderOpen size={16} />} onClick={() => void allowProjectsRoot().then(() => setTries(tries + 1), () => undefined)}>
                        Allow
                      </Button>
                    </>
                  ) : state.why === 'no-folder' && inbox.root.access === 'none' ? (
                    <>
                      <Text size="sm" ta="center">
                        It’s kept at {f.href}. To open it here, show EnviroDB the folder your projects are kept in (once, on this computer) – or copy the path into File Explorer.
                      </Text>
                      <Button variant="light" leftSection={<IconFolderOpen size={16} />} onClick={() => void connectProjectsRoot().then(() => setTries(tries + 1), () => undefined)}>
                        Show EnviroDB your projects folder
                      </Button>
                    </>
                  ) : state.why === 'no-folder' || state.why === 'elsewhere' ? (
                    <Text size="sm" ta="center">
                      It’s kept at {f.href} – outside your projects folder, so copy the path into File Explorer to open it.
                    </Text>
                  ) : (
                    <Alert color="orange" title="Not found">
                      {f.path ? `It isn’t in the shared folder (${f.path}) – moved or deleted there, or not synced to this computer yet.` : `There’s nothing at ${f.href} in your projects folder.`}
                    </Alert>
                  )}
                </Stack>
              </Center>
            ) : how === 'pdf' ? (
              <PdfPreview load={load} fill />
            ) : how === 'image' && state.url ? (
              <Center h="100%">
                <img src={state.url} alt={f.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 4 }} />
              </Center>
            ) : how === 'text' ? (
              <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{state.text}</pre>
            ) : (
              <Center h="100%">
                <Stack align="center" gap="xs">
                  <Text size="sm" ta="center">
                    This kind of file opens in its own program (Excel, Word, Outlook …).
                  </Text>
                  <Button leftSection={<IconDownload size={16} />} onClick={save}>
                    Download it
                  </Button>
                </Stack>
              </Center>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}

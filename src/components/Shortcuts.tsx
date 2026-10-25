// Keyboard shortcuts: Ctrl K for search, ? for this list, "g then a letter" to go to a page, 1–7 for a project's
// tabs. Never while typing in a field.

import { useEffect, useRef, useState } from 'react';
import { Kbd, Modal, Table, Text } from '@mantine/core';
import { useLocation, useNavigate } from 'react-router-dom';
import { GO_KEYS, SHORTCUTS } from '../lib/search';
import { PROJECT_TABS } from '../lib/features';

const typing = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable || !!el.closest('[contenteditable="true"]');
};

/** Listens for the shortcuts; `onSearch` opens the search. */
export function useShortcuts(onSearch: () => void, onHelp: () => void) {
  const navigate = useNavigate();
  const location = useLocation();
  const pending = useRef<number | null>(null); // a "g" waiting for its letter
  const here = useRef(location.pathname);
  here.current = location.pathname;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onSearch();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e)) return;
      // a dialog open: its own keys (a closed Mantine modal keeps its root in the page; its content only while open)
      if (document.querySelector('.mantine-Modal-content, .mantine-Drawer-content, [role="dialog"][aria-label="Photo"], [role="dialog"][aria-label^="Tour:"]')) return;
      if (e.key === '?') {
        e.preventDefault();
        onHelp();
        return;
      }
      if (pending.current !== null) {
        window.clearTimeout(pending.current);
        pending.current = null;
        const to = GO_KEYS[e.key.toLowerCase()];
        if (to) {
          e.preventDefault();
          navigate(to);
        }
        return;
      }
      if (e.key === 'g') {
        pending.current = window.setTimeout(() => (pending.current = null), 1200);
        return;
      }
      const m = /^\/projects\/([^/]+)/.exec(here.current);
      if (m && /^[1-7]$/.test(e.key)) {
        const tab = PROJECT_TABS[Number(e.key) - 1];
        if (tab) {
          e.preventDefault();
          navigate(`/projects/${m[1]}/${tab.value}`);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, onSearch, onHelp]);
}

export function ShortcutsHelp({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  return (
    <Modal opened={opened} onClose={onClose} title="Keyboard shortcuts" size="md">
      <Table verticalSpacing={6}>
        <Table.Tbody>
          {SHORTCUTS.map((s) => (
            <Table.Tr key={s.keys}>
              <Table.Td w={130} style={{ whiteSpace: 'nowrap' }}>
                {s.keys.split(/ (then) /).map((k, i) =>
                  k === 'then' ? (
                    <Text key={i} span size="xs" c="dimmed" mx={4}>
                      then
                    </Text>
                  ) : (
                    <Kbd key={i} size="sm">
                      {k}
                    </Kbd>
                  ),
                )}
              </Table.Td>
              <Table.Td>
                <Text size="sm">{s.does}</Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Text size="xs" c="dimmed" mt="sm">
        None of these fire while you’re typing in a field.
      </Text>
    </Modal>
  );
}

/** Search and shortcuts together, for the shell. */
export function useSearchAndShortcuts() {
  const [search, setSearch] = useState(false);
  const [help, setHelp] = useState(false);
  const openSearch = useRef(() => setSearch(true)).current;
  const openHelp = useRef(() => setHelp(true)).current;
  useShortcuts(openSearch, openHelp);
  return { search, setSearch, help, setHelp };
}

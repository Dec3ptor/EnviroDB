import { useEffect, type ReactNode } from 'react';
import { ActionIcon, Badge, Button, Tooltip, type ButtonProps } from '@mantine/core';
import { IconDeviceFloppy } from '@tabler/icons-react';

/** Asks before the page is closed or reloaded while there are unsaved edits. */
export function useUnsavedWarning(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
}

/** The save icon of a row of edits: plain until something changes, then orange and pulsing until it is saved. */
export function SaveIcon({ dirty, onClick, disabled, label = 'Save' }: { dirty: boolean; onClick: () => void; disabled?: boolean; label?: string }) {
  useUnsavedWarning(dirty);
  return (
    <Tooltip label={dirty ? `Unsaved changes – ${label.toLowerCase()}` : 'Nothing to save'} openDelay={300}>
      <ActionIcon variant={dirty ? 'filled' : 'subtle'} color={dirty ? 'orange' : 'gray'} className={dirty ? 'edb-save-pulse' : undefined} disabled={!dirty || disabled} onClick={onClick} aria-label={label}>
        <IconDeviceFloppy size={16} />
      </ActionIcon>
    </Tooltip>
  );
}

/** A Save button that stands out (orange, pulsing) while there are unsaved edits. */
export function SaveButton({ dirty, children = 'Save', ...props }: { dirty: boolean; children?: ReactNode } & ButtonProps & { onClick: () => void; disabled?: boolean }) {
  useUnsavedWarning(dirty);
  return (
    <Button leftSection={<IconDeviceFloppy size={16} />} color={dirty ? 'orange' : undefined} className={dirty ? 'edb-save-pulse' : undefined} {...props}>
      {children}
    </Button>
  );
}

/** "Unsaved changes" next to a card's title. */
export function UnsavedBadge({ dirty }: { dirty: boolean }) {
  return dirty ? (
    <Badge color="orange" variant="light">
      Unsaved changes
    </Badge>
  ) : null;
}

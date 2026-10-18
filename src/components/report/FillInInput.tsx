// A caption or notes box that fills in: type "[" and pick [site name], [date] … – or click one under the box. Shows
// what it will say with an example, so it's clear the wording is yours to change.

import { Anchor, Combobox, Group, Text, TextInput, Textarea, UnstyledButton, useCombobox } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import { fillCaption, fillKey, tidyCaption, type FillIn } from '../../reports/captions';

/** What's being typed at the caret – "[sit" or "{{sit" – and where it starts. */
function typing(text: string, caret: number): { from: number; query: string } | null {
  const m = /(\[|\{\{)([^[\]{}\n]{0,30})$/.exec(text.slice(0, caret));
  return m ? { from: m.index, query: m[2] } : null;
}

export function FillInInput({
  label,
  description,
  value,
  placeholder,
  fillIns,
  onChange,
  multiline,
  example,
  chips = 4,
}: {
  label: string;
  description?: string;
  value: string;
  placeholder?: string;
  fillIns: FillIn[];
  onChange: (v: string) => void;
  multiline?: boolean;
  /** Show "e.g. …" under the box, with this before it (e.g. "Table 3. "). */
  example?: string;
  /** How many fill-ins to show as links under the box (0: none – type "[" for them). */
  chips?: number;
}) {
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const caret = useRef<number | null>(null);
  const [at, setAt] = useState<{ from: number; query: string } | null>(null);
  const combobox = useCombobox({ onDropdownClose: () => combobox.resetSelectedOption() });
  const q = at ? fillKey(at.query) : '';
  const options = at ? fillIns.filter((f) => fillKey(f.name).includes(q) || fillKey(f.help).includes(q)) : [];

  useEffect(() => {
    if (at && options.length) combobox.selectFirstOption();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at?.query, options.length]);

  const look = (text: string, pos: number | null) => {
    caret.current = pos;
    const t = pos === null ? null : typing(text, pos);
    setAt(t);
    if (t) combobox.openDropdown();
    else combobox.closeDropdown();
  };

  /** Put a fill-in where the caret is – in place of what's been typed of it ("[sit"). */
  const put = (f: FillIn) => {
    const el = ref.current;
    const pos = caret.current ?? value.length;
    const t = at ?? typing(value, pos);
    const from = t ? t.from : pos;
    let to = pos;
    if (value[to] === ']') to++;
    const token = `[${f.name}]`;
    // a space before it when it isn't replacing what was typed of it, and would run on from a word
    const gap = from === pos && from > 0 && !/[\s([]$/.test(value.slice(0, from)) ? ' ' : '';
    const next = value.slice(0, from) + gap + token + value.slice(to);
    onChange(next);
    setAt(null);
    combobox.closeDropdown();
    const end = from + gap.length + token.length;
    caret.current = end;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(end, end);
    });
  };

  const examples = Object.fromEntries(fillIns.map((f) => [fillKey(f.name), f.example]));
  const shown = (value.trim() || placeholder || '').split('\n').map((line) => tidyCaption(fillCaption(line, examples)));
  const common = {
    ref,
    label,
    description,
    placeholder,
    value,
    size: 'xs' as const,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onChange(e.currentTarget.value);
      look(e.currentTarget.value, e.currentTarget.selectionStart);
    },
    onClick: (e: React.MouseEvent<HTMLInputElement | HTMLTextAreaElement>) => look(e.currentTarget.value, e.currentTarget.selectionStart),
    onKeyUp: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (!['ArrowUp', 'ArrowDown', 'Enter', 'Escape'].includes(e.key)) look(e.currentTarget.value, e.currentTarget.selectionStart);
      else caret.current = e.currentTarget.selectionStart;
    },
    onBlur: () => {
      combobox.closeDropdown();
      setAt(null);
    },
  };

  return (
    <div>
      <Combobox store={combobox} onOptionSubmit={(name) => put(fillIns.find((f) => f.name === name)!)} withinPortal position="bottom-start" width={300}>
        <Combobox.Target>{multiline ? <Textarea {...common} autosize minRows={2} maxRows={8} /> : <TextInput {...common} />}</Combobox.Target>
        <Combobox.Dropdown hidden={!options.length}>
          <Combobox.Options>
            {options.map((f) => (
              <Combobox.Option value={f.name} key={f.name}>
                <Text size="sm" lh={1.25}>
                  [{f.name}]
                </Text>
                <Text size="xs" c="dimmed" lh={1.25}>
                  {f.help} – e.g. {f.example}
                </Text>
              </Combobox.Option>
            ))}
          </Combobox.Options>
        </Combobox.Dropdown>
      </Combobox>
      {chips > 0 && (
      <Group gap={6} mt={4} wrap="wrap">
        <Text size="xs" c="dimmed">
          Fill in:
        </Text>
        {fillIns.slice(0, chips).map((f) => (
          <UnstyledButton key={f.name} onMouseDown={(e) => e.preventDefault()} onClick={() => put(f)} className="edb-fillin" title={`${f.help} – e.g. ${f.example}`}>
            [{f.name}]
          </UnstyledButton>
        ))}
        {fillIns.length > chips && (
          <Anchor
            component="button"
            type="button"
            size="xs"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              // all of them, to put in where the caret is
              const el = ref.current;
              const pos = caret.current ?? value.length;
              el?.focus();
              el?.setSelectionRange(pos, pos);
              caret.current = pos;
              setAt({ from: pos, query: '' });
              combobox.openDropdown();
            }}
          >
            more…
          </Anchor>
        )}
        <Text size="xs" c="dimmed">
          (or type [ )
        </Text>
      </Group>
      )}
      {example !== undefined && shown.some(Boolean) && (
        <Text size="xs" c="dimmed" mt={2} style={{ whiteSpace: 'pre-line' }}>
          e.g. “{example}
          {shown.join('\n')}”
        </Text>
      )}
    </div>
  );
}

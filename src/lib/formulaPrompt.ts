// The text for an AI to write a calculated parameter's formula: the formula's syntax – nothing else is understood – and
// the parameters it can use (names and units only: no results, sites or anything about the client). Pasted into an
// AI with what's wanted; its formula is pasted back into the parameter, where EnviroDB checks it and shows what it
// works out before anything is saved.

import { FUNCTION_HELP } from './formula';
import { unitLabel } from './units';

export function formulaPrompt(target: { name: string; unit: string }, params: Array<{ name: string; unit: string }>): string {
  const unit = unitLabel(target.unit);
  return [
    'I’m setting up a calculated parameter in EnviroDB (water-quality monitoring software). Please write ONE formula for it, using only the syntax below.',
    '',
    'What I want worked out: <describe it here – e.g. “dissolved oxygen in mg/L from DO % saturation and temperature”>',
    `The parameter it works out: ${target.name.trim() || 'a new parameter'}${unit ? ` (its unit: ${unit})` : ''}`,
    '',
    'Formula syntax – nothing else is understood:',
    '- A parameter’s value: its name in square brackets, exactly as listed below – e.g. [Temperature]. It’s the same sample’s value, in that parameter’s unit.',
    '- Numbers, + - * / ^ and brackets ( ).',
    ...FUNCTION_HELP.map((h) => `- ${h}`),
    `- The answer is in the unit of the parameter it works out${unit ? ` (${unit})` : ''}.`,
    '',
    'The parameters (name – unit):',
    ...params.map((p) => `- ${p.name}${unitLabel(p.unit) ? ` – ${unitLabel(p.unit)}` : ''}`),
    '',
    'Reply with the formula alone on the first line, then one line on what it does and where the method comes from.',
  ].join('\n');
}

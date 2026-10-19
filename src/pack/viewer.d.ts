import type { PackData } from './model';

/** Draw a data pack into an element (in its own shadow root, so its styles stay its own). */
export function renderPack(data: PackData, host: HTMLElement): void;

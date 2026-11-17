/**
 * The script language (§1, seam 1): `parse(text, file, read) → {ir, errors}`. Synchronous; its only I/O is
 * `read` for `src=` files. It hides the grammar, inline marks, spoken form, id resolution, visibility
 * inference, `reachable` and validation. Block bodies are parsed by the block modules, through the contract.
 */
import { BLOCKS } from '../blocks/registry.ts';
import type { Parse } from '../ir.ts';
import { createParse } from './parse.ts';

export const parse: Parse = createParse(Object.values(BLOCKS));

/** Every code the language reports, with a one-line summary (for the skill's error table). */

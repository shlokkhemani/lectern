/** Page bundle entry: read the embedded IR and install `window.lectern`. */
import type { Script } from '../ir.ts';
import { createPage } from './page.ts';

const ir = JSON.parse(document.getElementById('lectern-ir')!.textContent!) as Script;
window.lectern = createPage(ir, document.getElementById('stage')!);

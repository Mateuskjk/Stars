// Novidades do banner da Home, geradas sozinhas a partir dos commits (roda antes do build: "prebuild").
// Cada commit vira uma novidade: o título é a 1ª linha e os itens são as linhas "- ..." da mensagem.
// Sem git (ou sem histórico), mantém o arquivo que já está no repositório.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const OUT = 'src/app/home/novidades.json';
const MAX = 12;
// Commits que não interessam a quem usa o sistema
const SKIP = /^(Merge |Revert |Atualiza .*(npm|depend|alertas)|Correções v\d|wip\b)/i;

let log;
try {
  log = execFileSync('git', ['log', '--no-merges', '-n', '60', '--date=short', '--format=%h%x1f%ad%x1f%B%x1e'], { encoding: 'utf8' });
} catch {
  console.log('[novidades] sem git: mantendo', OUT);
  process.exit(0);
}

const items = log
  .split('\x1e')
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => {
    const [id, date, body] = entry.split('\x1f');
    const raw = body.split('\n');
    const bullets = [];
    for (const line of raw.slice(1)) {
      if (line.trim().startsWith('- ')) bullets.push(line.trim().slice(2).trim());
      else if (/^\s+\S/.test(line) && bullets.length) bullets[bullets.length - 1] += ' ' + line.trim(); // item que quebrou a linha
    }
    const useful = bullets.filter((l) => !/^(Co-Authored-By|Precisa de|Signed-off-by)/i.test(l));
    return { id, date, title: raw[0].trim(), items: useful.slice(0, 8) };
  })
  .filter((n) => n.title && !SKIP.test(n.title))
  .slice(0, MAX);

if (!items.length) {
  console.log('[novidades] nenhum commit encontrado: mantendo', OUT);
  process.exit(0);
}
writeFileSync(OUT, JSON.stringify(items, null, 2) + '\n');
console.log(`[novidades] ${items.length} novidades em ${OUT}`);

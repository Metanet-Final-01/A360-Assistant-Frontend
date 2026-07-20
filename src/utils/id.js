let idSeq = 0;

export function makeId(prefix) {
  idSeq += 1;
  return `${prefix}-${idSeq}`;
}

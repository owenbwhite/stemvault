interface MidiNote {
  ticks: number;
  noteNumber: number;
  velocity: number;
  durationTicks: number;
}

interface MidiMetadata {
  tempo?: number;
  timeSignature?: string;
  notes?: MidiNote[];
  [key: string]: unknown;
}

interface MidiDiffProps {
  labelA: string;
  labelB: string;
  metadataA: MidiMetadata | null;
  metadataB: MidiMetadata | null;
}

function noteToName(n: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return `${names[n % 12]}${Math.floor(n / 12) - 1}`;
}

function formatNote(note: MidiNote): string {
  return `  { tick: ${note.ticks.toString().padEnd(6)} note: ${noteToName(note.noteNumber).padEnd(4)} vel: ${note.velocity.toString().padEnd(4)} dur: ${note.durationTicks} }`;
}

function diffNotes(
  notesA: MidiNote[],
  notesB: MidiNote[]
): Array<{ line: string; type: 'same' | 'removed' | 'added' | 'changed' }> {
  // Key notes by tick+noteNumber for comparison
  const keyOf = (n: MidiNote) => `${n.ticks}:${n.noteNumber}`;
  const mapA = new Map(notesA.map((n) => [keyOf(n), n]));
  const mapB = new Map(notesB.map((n) => [keyOf(n), n]));

  const allKeys = new Set([...mapA.keys(), ...mapB.keys()]);
  const result: Array<{ line: string; type: 'same' | 'removed' | 'added' | 'changed' }> = [];

  for (const key of allKeys) {
    const a = mapA.get(key);
    const b = mapB.get(key);
    if (a && b) {
      if (a.velocity === b.velocity && a.durationTicks === b.durationTicks) {
        result.push({ line: formatNote(a), type: 'same' });
      } else {
        result.push({ line: formatNote(a), type: 'changed' });
      }
    } else if (a && !b) {
      result.push({ line: formatNote(a), type: 'removed' });
    } else if (!a && b) {
      result.push({ line: formatNote(b!), type: 'added' });
    }
  }

  return result.sort((x, y) => {
    const tickX = parseInt(x.line.match(/tick: (\d+)/)?.[1] ?? '0');
    const tickY = parseInt(y.line.match(/tick: (\d+)/)?.[1] ?? '0');
    return tickX - tickY;
  });
}

export function MidiDiff({ labelA, labelB, metadataA, metadataB }: MidiDiffProps) {
  if (!metadataA && !metadataB) return null;

  const notesA = metadataA?.notes ?? [];
  const notesB = metadataB?.notes ?? [];
  const diff = diffNotes(notesA, notesB);

  const added = diff.filter((d) => d.type === 'added').length;
  const removed = diff.filter((d) => d.type === 'removed').length;
  const changed = diff.filter((d) => d.type === 'changed').length;

  return (
    <div style={{ marginTop: '24px' }}>
      <p className="section-title">MIDI Diff</p>

      <div style={{ display: 'flex', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '12px', color: 'var(--accent-green)' }}>+{added} added</span>
        <span style={{ fontSize: '12px', color: 'var(--accent-red)' }}>{removed} removed</span>
        <span style={{ fontSize: '12px', color: 'var(--accent-orange)' }}>{changed} changed</span>
      </div>

      <div className="diff-container">
        <div className="diff-panel">
          <div className="diff-panel-header">{labelA}</div>
          <div className="diff-content">
            {`// tempo: ${metadataA?.tempo ?? '?'} bpm\n// time: ${metadataA?.timeSignature ?? '?'}\nnotes: [\n`}
            {diff.map((d, i) => {
              if (d.type === 'added') return null;
              const cls = d.type === 'removed' ? 'diff-removed' : d.type === 'changed' ? 'diff-changed' : '';
              return <span key={i} className={cls}>{d.line}{'\n'}</span>;
            })}
            {']'}
          </div>
        </div>

        <div className="diff-panel">
          <div className="diff-panel-header">{labelB}</div>
          <div className="diff-content">
            {`// tempo: ${metadataB?.tempo ?? '?'} bpm\n// time: ${metadataB?.timeSignature ?? '?'}\nnotes: [\n`}
            {diff.map((d, i) => {
              if (d.type === 'removed') return null;
              const cls = d.type === 'added' ? 'diff-added' : d.type === 'changed' ? 'diff-changed' : '';
              return <span key={i} className={cls}>{d.line}{'\n'}</span>;
            })}
            {']'}
          </div>
        </div>
      </div>
    </div>
  );
}

import React, { useEffect, useRef, useState, useCallback } from 'react';

export interface StemTrack {
  id: string;
  name: string;
  category?: string | null;
  fileType?: 'AUDIO' | 'MIDI';
  url: string;
  onNameClick?: () => void;
}

interface MixPlayerProps {
  stems: StemTrack[];
  autoPlay?: boolean;
  renderStemExtra?: (stem: StemTrack) => React.ReactNode;
}

export function MixPlayer({ stems, autoPlay, renderStemExtra }: MixPlayerProps) {
  const [loaded, setLoaded] = useState(0);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [gains, setGains] = useState<Record<string, number>>({});
  const [muted, setMuted] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const buffersRef = useRef<Record<string, AudioBuffer>>({});
  const gainNodesRef = useRef<Record<string, GainNode>>({});
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const startedAtRef = useRef(0);
  const offsetRef = useRef(0);
  const rafRef = useRef(0);
  // Keep latest gains/muted in refs so play() doesn't go stale
  const gainsRef = useRef<Record<string, number>>({});
  const mutedRef = useRef<Record<string, boolean>>({});

  useEffect(() => { gainsRef.current = gains; }, [gains]);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  useEffect(() => {
    const ctx = new AudioContext();
    ctxRef.current = ctx;

    const initial: Record<string, number> = {};
    for (const s of stems) initial[s.id] = 1;
    setGains(initial);
    gainsRef.current = initial;

    let loadedCount = 0;
    Promise.all(
      stems.map(async (s) => {
        const res = await fetch(s.url);
        const raw = await res.arrayBuffer();
        const buf = await ctx.decodeAudioData(raw);
        loadedCount++;
        setLoaded(loadedCount);
        return { id: s.id, buf };
      })
    ).then((results) => {
      let maxDur = 0;
      for (const { id, buf } of results) {
        buffersRef.current[id] = buf;
        maxDur = Math.max(maxDur, buf.duration);
      }
      setDuration(maxDur);
      setReady(true);
    }).catch((e) => {
      setError(e instanceof Error ? e.message : 'Failed to load stems');
    });

    return () => {
      cancelAnimationFrame(rafRef.current);
      ctx.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopSources = useCallback(() => {
    for (const src of sourcesRef.current) {
      try { src.stop(); } catch { /* already stopped */ }
    }
    sourcesRef.current = [];
    cancelAnimationFrame(rafRef.current);
  }, []);

  const startPlayback = useCallback((fromOffset: number) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    stopSources();

    const newSources: AudioBufferSourceNode[] = [];
    for (const stem of stems) {
      const buffer = buffersRef.current[stem.id];
      if (!buffer) continue;

      const gainNode = ctx.createGain();
      const isMuted = mutedRef.current[stem.id] ?? false;
      gainNode.gain.value = isMuted ? 0 : (gainsRef.current[stem.id] ?? 1);
      gainNode.connect(ctx.destination);
      gainNodesRef.current[stem.id] = gainNode;

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(gainNode);
      source.start(0, fromOffset);
      newSources.push(source);
    }

    sourcesRef.current = newSources;
    startedAtRef.current = ctx.currentTime;
    offsetRef.current = fromOffset;
    setPlaying(true);

    const tick = () => {
      const elapsed = (ctxRef.current?.currentTime ?? 0) - startedAtRef.current + offsetRef.current;
      if (elapsed >= duration) {
        stopSources();
        setPlaying(false);
        setCurrentTime(0);
        offsetRef.current = 0;
      } else {
        setCurrentTime(elapsed);
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [stems, duration, stopSources]);

  useEffect(() => {
    if (ready && autoPlay) {
      ctxRef.current?.resume().then(() => startPlayback(0));
    }
  }, [ready, autoPlay, startPlayback]);

  const toggle = async () => {
    if (playing) {
      offsetRef.current += (ctxRef.current?.currentTime ?? 0) - startedAtRef.current;
      stopSources();
      setPlaying(false);
    } else {
      await ctxRef.current?.resume();
      startPlayback(offsetRef.current);
    }
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const newOffset = ((e.clientX - rect.left) / rect.width) * duration;
    offsetRef.current = newOffset;
    setCurrentTime(newOffset);
    if (playing) startPlayback(newOffset);
  };

  const setGain = (stemId: string, value: number) => {
    gainsRef.current[stemId] = value;
    setGains((g) => ({ ...g, [stemId]: value }));
    const node = gainNodesRef.current[stemId];
    if (node && !(mutedRef.current[stemId])) node.gain.value = value;
  };

  const toggleMute = (stemId: string) => {
    const next = !(mutedRef.current[stemId] ?? false);
    mutedRef.current[stemId] = next;
    setMuted((m) => ({ ...m, [stemId]: next }));
    const node = gainNodesRef.current[stemId];
    if (node) node.gain.value = next ? 0 : (gainsRef.current[stemId] ?? 1);
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;

  if (error) return <p style={{ color: 'var(--accent-red)', fontSize: '13px', margin: 0 }}>{error}</p>;

  if (!ready) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
        <div style={{ flex: 1, height: 3, background: 'var(--border)', borderRadius: 2 }}>
          <div style={{ width: `${stems.length > 0 ? (loaded / stems.length) * 100 : 0}%`, height: '100%', background: 'var(--accent)', borderRadius: 2, transition: 'width 0.2s' }} />
        </div>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {loaded}/{stems.length} stems
        </span>
      </div>
    );
  }

  return (
    <div>
      {/* Transport */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <button
          className="btn-secondary btn-sm"
          onClick={toggle}
          style={{ width: 36, height: 36, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '14px' }}
        >
          {playing ? '⏸' : '▶'}
        </button>
        <div
          style={{ flex: 1, height: 5, background: 'var(--border)', borderRadius: 3, cursor: 'pointer', position: 'relative' }}
          onClick={seek}
        >
          <div style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%`, height: '100%', background: 'var(--accent)', borderRadius: 3, transition: 'width 0.05s linear' }} />
        </div>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
          {fmt(currentTime)} / {fmt(duration)}
        </span>
      </div>

      {/* Per-stem controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {stems.map((s) => {
          const isMuted = muted[s.id] ?? false;
          const stemDuration = buffersRef.current[s.id]?.duration ?? 0;
          return (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={() => toggleMute(s.id)}
                title={isMuted ? 'Unmute' : 'Mute'}
                style={{
                  width: 24, height: 24, flexShrink: 0, background: 'none', border: '1px solid var(--border)',
                  borderRadius: 4, cursor: 'pointer', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: isMuted ? 'var(--text-muted)' : 'var(--accent)',
                  opacity: isMuted ? 0.5 : 1,
                }}
              >
                {isMuted ? '✕' : '◉'}
              </button>
              {s.onNameClick ? (
                <button
                  onClick={s.onNameClick}
                  style={{ fontSize: '11px', color: isMuted ? 'var(--text-muted)' : 'var(--text-secondary)', width: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: isMuted ? 'line-through' : 'none', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', flexShrink: 0 }}
                >
                  {s.name}
                </button>
              ) : (
                <span style={{ fontSize: '11px', color: isMuted ? 'var(--text-muted)' : 'var(--text-secondary)', width: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: isMuted ? 'line-through' : 'none', flexShrink: 0 }}>
                  {s.name}
                </span>
              )}
              {s.fileType && (
                <span style={{ fontSize: '9px', fontWeight: 600, padding: '1px 5px', borderRadius: '999px', flexShrink: 0, letterSpacing: '0.3px', border: '1px solid var(--border)', color: s.fileType === 'MIDI' ? '#a78bfa' : 'var(--text-muted)', background: s.fileType === 'MIDI' ? 'rgba(167,139,250,0.1)' : 'transparent' }}>
                  {s.fileType}
                </span>
              )}
              {renderStemExtra?.(s)}
              {stemDuration > 0 && (
                <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                  {fmt(stemDuration)}
                </span>
              )}
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={gains[s.id] ?? 1}
                disabled={isMuted}
                onChange={(e) => setGain(s.id, parseFloat(e.target.value))}
                style={{ flex: 1, accentColor: 'var(--accent)', opacity: isMuted ? 0.35 : 1 }}
              />
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', width: 30, textAlign: 'right', flexShrink: 0 }}>
                {isMuted ? '—' : `${Math.round((gains[s.id] ?? 1) * 100)}%`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

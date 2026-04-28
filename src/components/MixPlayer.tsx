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
  const [readyCount, setReadyCount] = useState(0);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [gains, setGains] = useState<Record<string, number>>({});
  const [muted, setMuted] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const audioElsRef = useRef<Record<string, HTMLAudioElement>>({});
  const gainNodesRef = useRef<Record<string, GainNode>>({});
  const gainsRef = useRef<Record<string, number>>({});
  const mutedRef = useRef<Record<string, boolean>>({});
  const rafRef = useRef(0);
  const durationRef = useRef(0);
  const readyCountRef = useRef(0);

  useEffect(() => { gainsRef.current = gains; }, [gains]);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  useEffect(() => {
    if (stems.length === 0) return;

    const ctx = new AudioContext();
    ctxRef.current = ctx;

    const initial: Record<string, number> = {};
    for (const s of stems) initial[s.id] = 1;
    setGains(initial);
    gainsRef.current = initial;

    readyCountRef.current = 0;
    let maxDuration = 0;

    for (const stem of stems) {
      const audio = new Audio();
      audio.crossOrigin = 'anonymous';
      audio.preload = 'auto';
      audioElsRef.current[stem.id] = audio;

      const gainNode = ctx.createGain();
      gainNode.gain.value = 1;
      gainNode.connect(ctx.destination);
      gainNodesRef.current[stem.id] = gainNode;

      const source = ctx.createMediaElementSource(audio);
      source.connect(gainNode);

      const markReady = () => {
        readyCountRef.current += 1;
        setReadyCount(readyCountRef.current);
        if (readyCountRef.current === stems.length) setReady(true);
      };

      audio.addEventListener('loadedmetadata', () => {
        if (isFinite(audio.duration)) {
          maxDuration = Math.max(maxDuration, audio.duration);
          durationRef.current = maxDuration;
          setDuration(maxDuration);
        }
      });

      audio.addEventListener('canplaythrough', markReady, { once: true });
      if (audio.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) markReady();

      audio.addEventListener('error', () => setError(`Failed to load: ${stem.name}`));

      audio.src = stem.url;
      audio.load();
    }

    return () => {
      cancelAnimationFrame(rafRef.current);
      for (const audio of Object.values(audioElsRef.current)) {
        audio.pause();
        audio.src = '';
      }
      audioElsRef.current = {};
      gainNodesRef.current = {};
      ctx.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopRaf = useCallback(() => cancelAnimationFrame(rafRef.current), []);

  const startRaf = useCallback(() => {
    const tick = () => {
      const master = Object.values(audioElsRef.current)[0];
      if (!master) return;
      const t = master.currentTime;
      setCurrentTime(t);
      if (master.ended || t >= durationRef.current - 0.05) {
        for (const a of Object.values(audioElsRef.current)) {
          a.pause();
          a.currentTime = 0;
        }
        setPlaying(false);
        setCurrentTime(0);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    if (ready && autoPlay) {
      ctxRef.current?.resume().then(() => {
        for (const audio of Object.values(audioElsRef.current)) {
          audio.play().catch(() => {});
        }
        setPlaying(true);
        startRaf();
      });
    }
  }, [ready, autoPlay, startRaf]);

  const toggle = async () => {
    if (playing) {
      for (const audio of Object.values(audioElsRef.current)) audio.pause();
      stopRaf();
      setPlaying(false);
    } else {
      await ctxRef.current?.resume();
      for (const audio of Object.values(audioElsRef.current)) audio.play().catch(() => {});
      setPlaying(true);
      startRaf();
    }
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const newTime = ((e.clientX - rect.left) / rect.width) * durationRef.current;
    setCurrentTime(newTime);
    for (const audio of Object.values(audioElsRef.current)) {
      audio.currentTime = newTime;
    }
  };

  const setGain = (stemId: string, value: number) => {
    gainsRef.current[stemId] = value;
    setGains((g) => ({ ...g, [stemId]: value }));
    const node = gainNodesRef.current[stemId];
    if (node && !mutedRef.current[stemId]) node.gain.value = value;
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
          <div style={{ width: `${stems.length > 0 ? (readyCount / stems.length) * 100 : 0}%`, height: '100%', background: 'var(--accent)', borderRadius: 2, transition: 'width 0.2s' }} />
        </div>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {readyCount}/{stems.length} stems
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
          const stemDuration = audioElsRef.current[s.id]?.duration ?? 0;
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
              <div style={{ flex: 1, minWidth: 0 }}>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={gains[s.id] ?? 1}
                  disabled={isMuted}
                  onChange={(e) => setGain(s.id, parseFloat(e.target.value))}
                  style={{ width: '100%', display: 'block', accentColor: 'var(--accent)', opacity: isMuted ? 0.35 : 1, margin: 0 }}
                />
              </div>
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

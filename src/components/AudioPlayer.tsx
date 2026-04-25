import { useEffect, useRef, useState } from 'react';

interface AudioPlayerProps {
  src: string;
  waveformData?: number[] | null;
  label?: string;
}

export function AudioPlayer({ src, waveformData, label }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    setPlaying(false);
    setProgress(0);
    setCurrentTime(0);
  }, [src]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      audio.play().catch(() => {});
    }
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    audio.currentTime = ratio * duration;
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  // Normalize waveform data to 0..1 range for display
  const peaks = waveformData
    ? waveformData.map((v) => Math.abs(v))
    : Array.from({ length: 80 }, (_, i) =>
        0.3 + 0.5 * Math.sin(i * 0.4) * Math.sin(i * 0.13)
      );
  const maxPeak = Math.max(...peaks, 0.01);
  const normPeaks = peaks.map((v) => v / maxPeak);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {label && (
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          {label}
        </div>
      )}

      {/* Waveform */}
      <div
        className="waveform-container"
        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px 6px', gap: '1px' }}
        onClick={seek}
      >
        {normPeaks.slice(0, 120).map((peak, i) => {
          const ratio = duration > 0 ? currentTime / duration : 0;
          const barPos = i / normPeaks.length;
          const isPast = barPos < ratio;
          return (
            <div
              key={i}
              className="waveform-bar"
              style={{
                width: '2px',
                height: `${Math.max(3, peak * 40)}px`,
                background: isPast ? 'var(--accent)' : 'var(--text-muted)',
                opacity: isPast ? 0.9 : 0.4,
                flexShrink: 0,
              }}
            />
          );
        })}
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <button
          className="btn-secondary btn-sm"
          onClick={toggle}
          style={{ width: '32px', height: '32px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
        >
          {playing ? '⏸' : '▶'}
        </button>

        {/* Seek bar */}
        <div
          style={{
            flex: 1,
            height: '4px',
            background: 'var(--border)',
            borderRadius: '2px',
            cursor: 'pointer',
            position: 'relative',
          }}
          onClick={(e) => {
            const audio = audioRef.current;
            if (!audio || !duration) return;
            const rect = e.currentTarget.getBoundingClientRect();
            audio.currentTime = ((e.clientX - rect.left) / rect.width) * duration;
          }}
        >
          <div
            style={{
              width: `${progress * 100}%`,
              height: '100%',
              background: 'var(--accent)',
              borderRadius: '2px',
              transition: 'width 0.1s linear',
            }}
          />
        </div>

        <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>

      <audio
        ref={audioRef}
        src={src}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setProgress(0); }}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration ?? 0)}
        onTimeUpdate={() => {
          const audio = audioRef.current;
          if (!audio) return;
          setCurrentTime(audio.currentTime);
          setProgress(audio.duration > 0 ? audio.currentTime / audio.duration : 0);
        }}
        style={{ display: 'none' }}
        preload="metadata"
      />
    </div>
  );
}

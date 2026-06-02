import React, { useState, useRef } from 'react';

const AudioPlayer = React.memo(({ src }) => {
    const audioRef = useRef(null);
    const [playing, setPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [speed, setSpeed] = useState(1);

    const toggle = () => {
        const a = audioRef.current;
        if (!a) return;
        if (playing) { a.pause(); setPlaying(false); }
        else { a.play(); setPlaying(true); }
    };
    const handleTimeUpdate = () => {
        const a = audioRef.current;
        if (!a || !a.duration) return;
        setCurrentTime(a.currentTime);
        setProgress((a.currentTime / a.duration) * 100);
    };
    const handleLoaded = () => setDuration(audioRef.current?.duration || 0);
    const handleEnded = () => { setPlaying(false); setProgress(0); setCurrentTime(0); };
    const handleSeek = (e) => {
        const a = audioRef.current;
        if (!a || !a.duration) return;
        const rect = e.currentTarget.getBoundingClientRect();
        a.currentTime = ((e.clientX - rect.left) / rect.width) * a.duration;
    };
    const cycleSpeed = () => {
        const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
        setSpeed(next);
        if (audioRef.current) audioRef.current.playbackRate = next;
    };
    const fmt = (s) => {
        if (!s || isNaN(s)) return '0:00';
        return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    };

    return (
        <div className="flex items-center gap-2 py-1 px-1 min-w-[210px] max-w-[240px]">
            <audio ref={audioRef} src={src} onTimeUpdate={handleTimeUpdate} onLoadedMetadata={handleLoaded} onEnded={handleEnded} />
            <button onClick={toggle} className="w-9 h-9 rounded-full bg-[#00a884] flex items-center justify-center shrink-0 hover:bg-[#008f72] transition-colors shadow-sm">
                {playing
                    ? <svg viewBox="0 0 24 24" width="14" height="14" fill="white"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                    : <svg viewBox="0 0 24 24" width="14" height="14" fill="white"><polygon points="6 3 20 12 6 21 6 3"/></svg>
                }
            </button>
            <div className="flex-1 flex flex-col gap-1">
                <div className="w-full h-[3px] bg-black/10 dark:bg-white/15 rounded-full cursor-pointer relative" onClick={handleSeek}>
                    <div className="h-full bg-[#00a884] rounded-full" style={{ width: `${progress}%` }} />
                    <div className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-[#00a884] shadow" style={{ left: `calc(${progress}% - 5px)` }} />
                </div>
                <div className="flex justify-between text-[9px] text-[#8696a0] font-medium">
                    <span>{fmt(currentTime)}</span>
                    <span>{fmt(duration)}</span>
                </div>
            </div>
            <button onClick={cycleSpeed} className="text-[9px] font-bold text-[#8696a0] hover:text-[#54656f] dark:hover:text-white transition-colors shrink-0 bg-black/5 dark:bg-white/5 rounded px-1.5 py-0.5 min-w-[28px] text-center">
                {speed}x
            </button>
        </div>
    );
});

export default AudioPlayer;

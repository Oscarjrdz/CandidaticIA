import React from 'react';

const DateSeparator = React.memo(({ date }) => {
    const label = (() => {
        if (!date) return '';
        const d = new Date(date);
        if (isNaN(d)) return '';
        const today = new Date(); today.setHours(0,0,0,0);
        const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
        const msgDay = new Date(d); msgDay.setHours(0,0,0,0);
        if (msgDay.getTime() === today.getTime()) return 'HOY';
        if (msgDay.getTime() === yesterday.getTime()) return 'AYER';
        return new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Monterrey' }).format(d).toUpperCase();
    })();
    return (
        <div className="flex items-center justify-center my-3 select-none">
            <div className="bg-[#fff8dc] dark:bg-[#1f2c34] text-[#54656f] dark:text-[#8696a0] text-[11px] font-medium px-3 py-1 rounded-full shadow-sm border border-black/5 dark:border-white/5 tracking-wide">
                {label}
            </div>
        </div>
    );
});

export default DateSeparator;

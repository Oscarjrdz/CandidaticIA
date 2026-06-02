import React from 'react';

const MessageStatusTicks = React.memo(({ status, size = 'md' }) => {
    const isRead = status === 'seen' || status === 'read';
    const isDelivered = isRead || status === 'delivered';
    const isSent = isDelivered || status === 'sent';

    const color = isRead ? '#53bdeb' : '#8696a0';

    if (status === 'failed') {
        return (
            <span className="inline-flex items-center self-end mb-[1px] ml-1 text-red-500" title="Error de envío">
                <svg viewBox="0 0 24 24" width={14} height={14} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            </span>
        );
    }

    if (!isSent) {
        return (
            <span className="inline-flex items-center self-end mb-[1px] ml-1">
                <svg viewBox="0 0 12 12" width={12} height={12} fill="none" className="animate-[spin_2s_linear_infinite] origin-center">
                    <path d="M6 1a5 5 0 100 10A5 5 0 006 1zm.5 5.5H4V5.25h1.25V3h1.25v3.5z" fill="#8696a0" opacity="0.55" />
                </svg>
            </span>
        );
    }

    if (!isDelivered) {
        return (
            <span className="inline-flex items-center self-end mb-[1px] ml-1">
                <svg viewBox="0 0 12 11" width={14} height={13} fill="none">
                    <path d="M11.155 1.34l1.345 1.32L5.3 9.858 1.5 6.058l1.345-1.32L5.3 7.193z" fill="#8696a0" />
                </svg>
            </span>
        );
    }

    return (
        <span className="inline-flex items-center self-end mb-[1px] ml-1">
            <svg viewBox="0 0 16 11" width={18} height={13} fill="none">
                <path d="M11.071 0l-5.45 6.546-1.84-2.21L2.2 5.664 5.619 9.68 12.65 1.328z" fill={color} />
                <path d="M14.871 0l-5.45 6.546-0.635-.762L7.205 7.112l2.217 2.568L16.451 1.328z" fill={color} />
            </svg>
        </span>
    );
});

export default MessageStatusTicks;

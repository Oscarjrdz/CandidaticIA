import React from 'react';

/**
 * Universal section skeleton — shown while React.lazy loads a section chunk.
 * Matches the typical section layout: header + content area with shimmer.
 */
const SectionSkeleton = () => (
    <div className="max-w-[1400px] mx-auto w-full animate-pulse">
        {/* Header skeleton */}
        <div className="flex justify-between items-center mb-6">
            <div className="space-y-2">
                <div className="h-6 w-48 bg-gray-200 dark:bg-gray-700 rounded-lg" />
                <div className="h-3 w-64 bg-gray-100 dark:bg-gray-800 rounded" />
            </div>
            <div className="h-8 w-24 bg-gray-200 dark:bg-gray-700 rounded-lg" />
        </div>

        {/* KPI row skeleton */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {[...Array(4)].map((_, i) => (
                <div key={i} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 shadow-sm">
                    <div className="h-2.5 w-16 bg-gray-200 dark:bg-gray-700 rounded mb-2" />
                    <div className="h-7 w-20 bg-gray-200 dark:bg-gray-700 rounded" />
                </div>
            ))}
        </div>

        {/* Content area skeleton */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 shadow-sm space-y-4">
            {[...Array(6)].map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 shrink-0" />
                    <div className="flex-1 space-y-2">
                        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded" style={{ width: `${70 - i * 8}%` }} />
                        <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded" style={{ width: `${50 - i * 5}%` }} />
                    </div>
                    <div className="h-6 w-16 bg-gray-100 dark:bg-gray-800 rounded shrink-0" />
                </div>
            ))}
        </div>
    </div>
);

export default SectionSkeleton;

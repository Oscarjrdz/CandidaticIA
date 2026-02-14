import React from 'react';

const Skeleton = ({ className }) => {
    return (
        <div className={`animate-pulse bg-gray-200 dark:bg-gray-700 rounded ${className} relative overflow-hidden`}>
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent"></div>
        </div>
    );
};

export const ProjectSkeleton = () => (
    <div className="p-4 rounded-2xl border border-slate-100 dark:bg-slate-800 dark:border-slate-700 space-y-3">
        <div className="flex justify-between items-start">
            <div className="space-y-2 flex-1">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
            </div>
        </div>
        <div className="flex justify-between items-center pt-2">
            <div className="flex -space-x-2">
                <Skeleton className="w-5 h-5 rounded-full" />
                <Skeleton className="w-5 h-5 rounded-full" />
            </div>
            <Skeleton className="h-2 w-12" />
        </div>
    </div>
);

export const TableRowSkeleton = ({ columns = 6 }) => (
    <tr className="border-b border-gray-100 dark:border-gray-800">
        <td className="py-4 px-2"><Skeleton className="h-3 w-3 rounded-full mx-auto" /></td>
        <td className="py-4 px-2"><Skeleton className="h-8 w-8 rounded-full mx-auto" /></td>
        {[...Array(columns)].map((_, i) => (
            <td key={i} className="py-4 px-4"><Skeleton className="h-3 w-24" /></td>
        ))}
        <td className="py-4 px-2"><Skeleton className="h-6 w-6 rounded-md mx-auto" /></td>
    </tr>
);

export const CardSkeleton = () => (
    <div className="p-4 rounded-xl border border-gray-100 dark:bg-gray-800 dark:border-gray-700 space-y-3">
        <Skeleton className="h-2 w-16" />
        <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-12" />
            <Skeleton className="h-4 w-24" />
        </div>
    </div>
);

export default Skeleton;

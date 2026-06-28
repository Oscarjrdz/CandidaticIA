import { isProfileComplete } from './profileUtils';
import { checkIfUnread } from '../components/chat/chatUtils';

export const passesChatRBACFilter = (candidate, user) => {
    if (!user || user.role === 'SuperAdmin' || user.role === 'Admin') return true;

    // ── WA number filter (AND — must pass before CRM/label check) ──
    const allowedWa = user?.allowed_wa_numbers;
    if (Array.isArray(allowedWa) && allowedWa.length > 0) {
        const phoneId = candidate?.incomingPhoneNumberId;
        if (!phoneId || !allowedWa.includes(phoneId)) return false;
    }

    // ── CRM project / label filter (OR between them) ──
    const allowedCrm = user?.allowed_crm_projects;
    const hasCrmRestriction = Array.isArray(allowedCrm) && allowedCrm.length > 0;

    const allowedLabels = user?.allowed_labels;
    const hasLabelRestriction = Array.isArray(allowedLabels) && allowedLabels.length > 0;

    if (!hasCrmRestriction && !hasLabelRestriction) return true;

    const inAllowedCrm = hasCrmRestriction && candidate?.manualProjectId && allowedCrm.includes(candidate.manualProjectId);
    const inAllowedLabel = hasLabelRestriction && Array.isArray(candidate?.tags) && candidate.tags.some(t => {
        const searchLabel = typeof t === 'string' ? t.trim().toLowerCase() : (t?.name?.trim()?.toLowerCase() || '');
        return searchLabel && allowedLabels.some(al => typeof al === 'string' && al.trim().toLowerCase() === searchLabel);
    });

    return inAllowedCrm || inAllowedLabel;
};

export const canSeeIncompleteChats = (user, rolePermissions) => (
    user?.role === 'SuperAdmin' ||
    !rolePermissions ||
    Object.keys(rolePermissions).length === 0 ||
    rolePermissions.view_incomplete_candidates === true
);

export const countVisibleUnreadChats = (candidates = [], user, rolePermissions) => {
    const canSeeIncomplete = canSeeIncompleteChats(user, rolePermissions);

    return candidates.reduce((count, candidate) => {
        if (!passesChatRBACFilter(candidate, user)) return count;
        if (!isProfileComplete(candidate) && !canSeeIncomplete) return count;
        return checkIfUnread(candidate) ? count + 1 : count;
    }, 0);
};

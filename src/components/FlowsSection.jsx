import React, { useState } from 'react';
import FlowsGallery from './flows/FlowsGallery';
import FlowEditor from './flows/FlowEditor';

const FlowsSection = () => {
    const [openFlowId, setOpenFlowId] = useState(null);

    if (openFlowId) {
        return <FlowEditor flowId={openFlowId} onBack={() => setOpenFlowId(null)} />;
    }

    return (
        <div className="h-full overflow-y-auto">
            <FlowsGallery onOpenFlow={setOpenFlowId} />
        </div>
    );
};

export default FlowsSection;

const aiResult = {
    extracted_data: {
        tieneEmpleo: false
    }
};

const candidateData = {};
const candidateUpdates = {};

Object.entries(aiResult.extracted_data).forEach(([key, val]) => {
    // 🛡️ JSON Falsy Shield: Allow explicitly boolean 'false' through
    const isDefined = val !== null && val !== undefined && val !== 'null';

    if (isDefined && candidateData[key] !== val) {
        let cleanedVal = val;

        // Handle 'tieneEmpleo' strictly
        if (key === 'tieneEmpleo') {
            const strVal = String(val).toLowerCase().trim();
            if (strVal === 'si' || strVal === 'sí' || strVal === 'true') {
                cleanedVal = 'Sí';
            } else if (strVal === 'no' || strVal === 'false') {
                cleanedVal = 'No';
            }
        }
        candidateUpdates[key] = cleanedVal;
    }
});

console.log("Candidate Updates:", candidateUpdates);

// Also test if it's "No"
const aiResult2 = { extracted_data: { tieneEmpleo: "No" } };
const candidateUpdates2 = {};
Object.entries(aiResult2.extracted_data).forEach(([key, val]) => {
    const isDefined = val !== null && val !== undefined && val !== 'null';
    if (isDefined && candidateData[key] !== val) {
        let cleanedVal = val;
        if (key === 'tieneEmpleo') {
            const strVal = String(val).toLowerCase().trim();
            if (strVal === 'si' || strVal === 'sí' || strVal === 'true') {
                cleanedVal = 'Sí';
            } else if (strVal === 'no' || strVal === 'false') {
                cleanedVal = 'No';
            }
        }
        candidateUpdates2[key] = cleanedVal;
    }
});

console.log("Candidate Updates 2:", candidateUpdates2);

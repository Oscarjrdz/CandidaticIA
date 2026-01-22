import React, { useState } from 'react';
import { X } from 'lucide-react';

/**
 * Facebook-style tag input for phrases
 * User types phrase → Press Enter → Creates tag chip
 */
const PhraseTagInput = ({ phrases = [], onChange, placeholder = "Escribe una frase y presiona Enter..." }) => {
    const [inputValue, setInputValue] = useState('');

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && inputValue.trim()) {
            e.preventDefault();
            const newPhrase = inputValue.trim();

            // Avoid duplicates
            if (!phrases.includes(newPhrase)) {
                onChange([...phrases, newPhrase]);
            }
            setInputValue('');
        } else if (e.key === 'Backspace' && !inputValue && phrases.length > 0) {
            // Remove last tag on backspace if input is empty
            onChange(phrases.slice(0, -1));
        }
    };

    const removePhrase = (indexToRemove) => {
        onChange(phrases.filter((_, index) => index !== indexToRemove));
    };

    return (
        <div className="border border-gray-300 dark:border-gray-600 rounded-lg p-2 bg-white dark:bg-gray-900 focus-within:ring-2 focus-within:ring-gray-200 dark:focus-within:ring-gray-700/50 focus-within:border-gray-400 dark:focus-within:border-gray-500">
            <div className="flex flex-wrap gap-2 mb-2">
                {phrases.map((phrase, index) => (
                    <span
                        key={index}
                        className="inline-flex items-center space-x-1 px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm font-medium"
                    >
                        <span>{phrase}</span>
                        <button
                            type="button"
                            onClick={() => removePhrase(index)}
                            className="hover:bg-blue-200 dark:hover:bg-blue-800 rounded-full p-0.5 transition-colors"
                        >
                            <X className="w-3 h-3" />
                        </button>
                    </span>
                ))}
            </div>
            <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={phrases.length === 0 ? placeholder : "Agregar otra frase..."}
                className="w-full px-2 py-1 bg-transparent border-none focus:outline-none text-gray-900 dark:text-white text-sm"
            />
        </div>
    );
};

export default PhraseTagInput;

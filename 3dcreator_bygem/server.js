require('dotenv').config();
const express = require('express');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(express.static('public'));
app.use(express.json({ limit: '100mb' }));

app.post('/api/enhance', async (req, res) => {
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey || apiKey === 'your_gemini_api_key_here') {
            return res.status(401).json({ error: "Gemini API key is not configured in .env file." });
        }

        const { systemPrompt, userPrompt, image, referenceImages } = req.body;

        console.log('--- /api/enhance request ---');
        console.log('Has main image:', !!image);
        console.log('User prompt:', userPrompt);
        console.log('Reference images received:', referenceImages ? referenceImages.length : 0);
        if (referenceImages && referenceImages.length > 0) {
            referenceImages.forEach((r, i) => {
                console.log(`  ref[${i}]: starts with "${r?.substring(0, 30)}...", length: ${r?.length}`);
            });
        }

        if (!image || !image.startsWith('data:image/')) {
            return res.status(400).json({ error: "Invalid image data provided." });
        }

        // Initialize the new SDK
        const ai = new GoogleGenAI({ apiKey: apiKey });

        const base64Data = image.split(',')[1];
        const mainMimeType = image.match(/^data:(image\/\w+);/)?.[1] || 'image/png';

        const hasReferenceImages = referenceImages && Array.isArray(referenceImages) && referenceImages.length > 0;

        const parts = [];

        // Start with system instruction
        parts.push({ text: `System Instruction: ${systemPrompt}` });

        // Main scene image with label
        parts.push({ text: hasReferenceImages ? 'This is the MAIN SCENE image to edit:' : '' });
        parts.push({
            inlineData: {
                data: base64Data,
                mimeType: mainMimeType
            }
        });

        // Add each reference image with an explicit label
        if (hasReferenceImages) {
            referenceImages.forEach((refImg, idx) => {
                if (refImg && refImg.startsWith('data:image/')) {
                    const refBase64 = refImg.split(',')[1];
                    const refMimeType = refImg.match(/^data:(image\/\w+);/)?.[1] || 'image/png';
                    parts.push({ text: `Reference image ${idx + 1} — use this as a visual reference for the user's request below:` });
                    parts.push({
                        inlineData: {
                            data: refBase64,
                            mimeType: refMimeType
                        }
                    });
                }
            });
        }

        // User request last so it's closest to where Gemini generates output
        let userRequestText = `\n\nUser Request: ${userPrompt || 'Render this scene realistically.'}`;
        if (hasReferenceImages) {
            userRequestText += `\n\nIMPORTANT: The user has provided ${referenceImages.length} reference image(s) above. You MUST incorporate the items/elements shown in the reference image(s) into the main scene according to the user's request. The reference images show exactly what the user wants added or changed in the main scene.`;
        }
        parts.push({ text: userRequestText });

        console.log('Parts being sent to Gemini:');
        parts.forEach((p, i) => {
            if (p.text) console.log(`  part[${i}]: TEXT = "${p.text.substring(0, 80)}..."`);
            if (p.inlineData) console.log(`  part[${i}]: IMAGE (${p.inlineData.mimeType}, ${p.inlineData.data.length} chars base64)`);
        });

        const response = await ai.models.generateContent({
            model: 'gemini-3-pro-image-preview',
            contents: parts,
            config: {
                temperature: 0.7,
            }
        });

        // The response might contain text and/or inlineData for the generated image.
        let outputImageBase64 = null;
        let outputText = "";

        if (response.candidates && response.candidates[0].content.parts) {
            for (const part of response.candidates[0].content.parts) {
                if (part.inlineData) {
                    outputImageBase64 = part.inlineData.data;
                }
                if (part.text) {
                    outputText += part.text + "\n";
                }
            }
        } else if (response.text) {
            outputText = response.text;
        }

        if (outputImageBase64) {
            res.json({ result: `data:image/png;base64,${outputImageBase64}`, isImage: true, text: outputText });
        } else {
            res.json({ result: outputText || "No image returned.", isImage: false });
        }
    } catch (error) {
        console.error("Error calling Gemini API:", error);
        res.status(500).json({ error: error.message || "Failed to process image with Gemini." });
    }
});

const PORT = 8000;
app.listen(PORT, () => {
    console.log(`Interactive viewer running at http://localhost:${PORT}`);
    console.log(`API endpoints active.`);
});
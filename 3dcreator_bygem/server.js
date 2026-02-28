require('dotenv').config();
const express = require('express');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(express.static('public'));
app.use(express.json({ limit: '50mb' }));

app.post('/api/enhance', async (req, res) => {
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey || apiKey === 'your_gemini_api_key_here') {
            return res.status(401).json({ error: "Gemini API key is not configured in .env file." });
        }

        const { systemPrompt, userPrompt, image } = req.body;
        
        if (!image || !image.startsWith('data:image/')) {
            return res.status(400).json({ error: "Invalid image data provided." });
        }

        // Initialize the new SDK
        const ai = new GoogleGenAI({ apiKey: apiKey });

        const base64Data = image.split(',')[1];
        
        const parts = [
            {
                inlineData: {
                    data: base64Data,
                    mimeType: "image/png"
                }
            },
            { text: `System Instruction: ${systemPrompt}\n\nUser Request: ${userPrompt || 'Render this scene realistically.'}` }
        ];

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
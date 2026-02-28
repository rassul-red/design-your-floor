const puppeteer = require('puppeteer');
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const PORT = 3000;

const server = app.listen(PORT, async () => {
    console.log(`Server started on http://localhost:${PORT}`);
    
    // Command line args
    const jsonFile = process.argv[2] || 'json examples/plan_346.json';
    const outImage = process.argv[3] || 'output_render.png';
    const camHeight = parseFloat(process.argv[4]) || 1.8;
    const camX = parseFloat(process.argv[5]) || 128;
    const camY = parseFloat(process.argv[6]) || 128;
    const camAngle = parseFloat(process.argv[7]) || 45;

    console.log(`Rendering ${jsonFile}...`);

    try {
        const jsonData = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));

        const browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox']
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });
        
        // Wait for page to load Three.js and our script
        await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle0' });

        // Call the headless function
        const dataUrl = await page.evaluate((data, config) => {
            return window.renderHeadless(data, config);
        }, jsonData, { height: camHeight, x: camX, y: camY, angle: camAngle });

        // Save image
        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
        fs.writeFileSync(outImage, base64Data, 'base64');
        console.log(`Rendered image saved to ${outImage}`);

        await browser.close();
    } catch (err) {
        console.error("Error during rendering:", err);
    } finally {
        server.close();
        process.exit(0);
    }
});

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
            // Need to mock window.renderHeadless to use rotation instead of orbit
            build3DModel(data);
            
            const h = config.height || 1.8;
            const x = config.x || 128;
            const y = config.y || 128;
            const angleDeg = config.angle || 0;
            
            const offsetX = floorPlanGroup.position.x;
            const offsetZ = floorPlanGroup.position.z;

            const camWorldX = x * SCALE + offsetX;
            const camWorldZ = y * SCALE + offsetZ;
            const camWorldY = h;

            camera.position.set(camWorldX, camWorldY, camWorldZ);
            
            cameraYaw = angleDeg * Math.PI / 180;
            cameraPitch = 0;
            updateCameraRotation();
            
            renderer.render(scene, camera);
            return renderer.domElement.toDataURL('image/png');
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

import express from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import url from 'url';
import axios from 'axios';
import ffmpeg from 'ffmpeg';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import csrf from 'csurf';
import cookieParser from 'cookie-parser';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const port = process.env.PORT || 8090;

const logoPath = path.resolve(process.cwd(), 'Wanderstories-logo.png');
const acceptedFormats = ['mp4'];
const tempFileDir = path.resolve(process.cwd(), 'temp');
const outputDir = path.resolve(process.cwd(), 'videos');

const app = express();

// Use necessary middleware
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cookieParser());
app.use(csrf({ cookie: true }));
app.use(helmet());
app.use(compression());
app.use(cors());
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
});
app.use(limiter);

// Check if the directories exist, if not create them
if (!fs.existsSync(outputDir)){
    fs.mkdirSync(outputDir, { recursive: true });
}
if (!fs.existsSync(tempFileDir)){
    fs.mkdirSync(tempFileDir, { recursive: true });
}


app.get('/', (req, res) => {
    res.status(200).contentType('text/plain').send('Wanderstories Video Watermarker');
});

app.get('/favicon.ico', async (req, res, next) => {
    res.sendFile('favicon.ico', { root: __dirname });
})

app.get('/content/images/videos/*', processVideoRequest);
app.get('/content/media/*', processVideoRequest);

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something went wrong!');
});

app.listen(port, () => {
    console.log(`Listening on port http://localhost:${port}`);
});

async function processVideoRequest(req, res, next) {
    let requestedPath = req.path;

	// check that the requestedPath starts with /content/images/videos/ or /content/media/
	if (!requestedPath.startsWith('/content/images/videos/') && !requestedPath.startsWith('/content/media/')) {
		// Block the request if it's not a valid path
		return res.status(400).send('Invalid request');
	}

	// Very strict validation to only allow certain characters in the path
	if (requestedPath.includes('../') || requestedPath.includes('..\\') || !/^[\w\-\/\.]+$/.test(requestedPath)) {
        // Block the request if it contains path traversal
        return res.status(400).send('Invalid request');
    }

    const fileExtension = path.extname(requestedPath).slice(1).toLowerCase();
    const isAcceptedFormat = acceptedFormats.includes(fileExtension);

    if (!isAcceptedFormat) {
		// Block the request if it's not an accepted format
        return res.status(400).send('Invalid request');
    }

    const filename = path.basename(requestedPath);
    const tempFilePath = path.join(tempFileDir, filename);
    const outputPath = path.join(outputDir, filename);

    try {
        const originalVideoUrl = `https://wanderstories.space${requestedPath}`;

        // Check for file existence and avoid reprocessing
        if (fs.existsSync(outputPath)) {
            console.log('File already exists, returning cached version', filename);
            console.log('outputPath:', outputPath);
            if (fs.existsSync(outputPath)) {
                return res.sendFile(outputPath);
            } else {
                console.log('File does not exist:', outputPath);
            }
        }
        
        console.log('Processing video:', filename)

        const response = await axios({
            method: 'GET',
            url: originalVideoUrl,
            responseType: 'stream',
        });
        
        await new Promise((resolve, reject) => {
            const writeStream = response.data.pipe(fs.createWriteStream(tempFilePath));
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
        });

        await processVideo(tempFilePath, outputPath);
        
        return res.sendFile(outputPath);

    } catch (err) {
        if (err.response && err.response.status === 404) {
            console.error('Resource not found:', err.config.url);
            return res.status(404).send('Not Found');
        }
        console.error('Unexpected error:', err);
        next(err);
    }
}

async function processVideo(inputPath, outputPath) {
	const process = new ffmpeg(inputPath);
	await process.then((video) => {
		return new Promise((resolve, reject) => {
			video.fnAddWatermark(logoPath, outputPath, { position: 'C' }, (error) => {
				if (error) return reject(error);
				resolve();
			});
		});
	}).finally(() => {
		// Delete the inputPath file using unlink
		fs.unlink(inputPath, (err) => {
			if (err) {
				console.error(err);
				return;
			}
			// File deleted successfully
			// console.log('Temp file successfully deleted');
		});
	});
}
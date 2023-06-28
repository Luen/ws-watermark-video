import express from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import ffmpeg from 'ffmpeg';

const app = express();
const port = process.env.PORT || 8090;
const logoPath = path.resolve(process.cwd(), 'Wanderstories-logo.png');
const acceptedFormats = ['mp4'];
const tempFileDir = path.resolve(process.cwd(), 'temp');
const outputDir = path.resolve(process.cwd(), 'videos');
// Check if the directory exists, if not create it
if (!fs.existsSync(outputDir)){
	fs.mkdirSync(outputDir, { recursive: true });
}
if (!fs.existsSync(tempFileDir)){
	fs.mkdirSync(tempFileDir, { recursive: true });
}	

const limiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 100,
	standardHeaders: true,
	legacyHeaders: false,
});
app.use(limiter);

app.get('/', (req, res) => {
	res.status(200).contentType('text/plain').send('Wanderstories Video Watermarker');
});

app.get('*', processVideoRequest);

app.use((err, req, res, next) => {
	console.error(err.stack);
	res.status(500).send('Something went wrong!');
});

app.listen(port, () => {
	console.log(`Listening on port ${port}`);
});

async function processVideoRequest(req, res, next) {
	const url = req.url;
	const originalVideoUrl = `https://wanderstories.space${url}`;
	const fileExtension = path.extname(originalVideoUrl).slice(1).toLowerCase();
	const isAcceptedFormat = acceptedFormats.includes(fileExtension);

	if (!isAcceptedFormat || !isValidPath(url)) {
		return res.status(404).send('Not Found');
	}

	const filename = path.basename(originalVideoUrl);
	const tempFilePath = path.join(tempFileDir, filename);
	const outputPath = path.join(outputDir, filename);

	try {
		if (fs.existsSync(outputPath)) {
			console.log('File already exists, returning cached version', filename);
			return res.sendFile(outputPath);
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

function isValidPath(requestPath) {
	const segments = requestPath.split('/');
	return (segments[1] === 'content' && segments[2] === 'images' && segments[3] === 'videos') || segments[2] === 'media';
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
		console.log('Delete temp file:', inputPath);
		// Delete the inputPath file using unlink
		fs.unlink(inputPath, (err) => {
			if (err) {
				console.error(err);
				return;
			}
			// File deleted successfully
			console.log('Temp file deleted');
		});
	});
}

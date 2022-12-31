const express = require('express')
const rateLimit = require('express-rate-limit')
const fs = require('fs')
const path = require('path')
const axios = require("axios")
const ffmpeg = require("ffmpeg")

const app = express()
const port = process.env.PORT || 8090

const limiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
	standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
	legacyHeaders: false, // Disable the `X-RateLimit-*` headers
})
// Apply the rate limiting middleware to all requests
app.use(limiter)

app.get('/', (req, res) => {
	res.writeHead(200, {
		'Content-Type': 'text/plain'
	});
	res.end('Wanderstories Video Watermarker');
});

app.get('*', async (req, res) => {
	const FILENAME = escape(req.url);
	const ORIGINAL_VIDEO = `https://wanderstories.space${FILENAME}`;
	const FILE_EXTENSION = ORIGINAL_VIDEO.split('.').pop().toLowerCase();
	const LOGO = path.resolve(__dirname + "/Wanderstories-logo.png");
	const ACCEPTED_FORMATS = ['mp4'];

	if (
		ACCEPTED_FORMATS.indexOf(FILE_EXTENSION) >= 0 &&
		FILENAME.split('/')[1] == 'content' &&
		FILENAME.split('/')[2] == 'images' &&
		FILENAME.split('/')[3] == 'videos'
	) {
		const PATH = path.resolve(__dirname + FILENAME.replace('/content/images', ''));
		const tempFilename = path.basename(ORIGINAL_VIDEO);

		if (fs.existsSync(__dirname + tempFilename)) {
			console.log('Already processing, please wait: ', tempFilename);
			console.log('Redirect to original video while video is processing');
			res.redirect(ORIGINAL_VIDEO);
		} else {
			const localFilePath = path.resolve(__dirname, tempFilename);
			console.log('localFilePath ', localFilePath);
			console.log('Downloading file: ', tempFilename);

			try {
				const response = await axios({
					method: 'GET',
					url: ORIGINAL_VIDEO,
					responseType: 'stream',
				});

				const w = response.data.pipe(fs.createWriteStream(localFilePath));
				w.on('finish', () => {
					console.log('Successfully downloaded file: ', tempFilename);

					try {
						console.log('Processing file: ', tempFilename);
						const process = new ffmpeg(tempFilename);
						process.then(
							function (video) {
								video.fnAddWatermark(LOGO, PATH, {
									position: 'C',
								}, function (error, file) {
									console.log('Successfully delete temp file: ' + tempFilename);
									fs.unlinkSync(tempFilename);

									if (!error) {
										console.log('Successfully processed file: ' + file);
										res.sendFile(PATH);
									} else {
										console.log('Error: ', error);
										fs.unlink(PATH);
										fs.unlink(tempFilename);
									}
								});
							},
							function (err) {
								console.log('Error: ' + err);
								fs.unlink(PATH);
								fs.unlink(tempFilename);
							}
						);
					} catch (e) {
						console.log(e.code);
						console.log(e.msg);
						fs.unlink(PATH);
						fs.unlink(tempFilename);
					}
				});
			} catch (err) {
				throw new Error(err);
			}
		}
	} else {
		res.status(404).send('Not Found !!!');
	}
});

app.listen(port);
console.log('Listening on port ' + port);
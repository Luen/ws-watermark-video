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

app.get('/', async (req, res, next) => {
  res.writeHead(200, {
    'Content-Type': 'text/plain'
  })
  res.end('Wanderstories Video Watermarker')
})

app.get('*', function(req, res) {

  const FILENAME = escape(req.url)

  const ORIGINAL_VIDEO = "https://wanderstories.space" + FILENAME

  const FILE_EXTENSION = ORIGINAL_VIDEO.split('.').pop().toLowerCase()

  const LOGO = path.resolve(__dirname + "/Wanderstories-logo.png")
  //const LOGO = "./Wanderstories-logo.png"

  const ACCEPTED_FORMATS = [
    'mp4'
  ]

   // If an accepted file extensinon && path is /content/images/videos
  if (ACCEPTED_FORMATS.indexOf(FILE_EXTENSION) >= 0 && FILENAME.split('/')[1] == 'content' && FILENAME.split('/')[2] == 'images' && FILENAME.split('/')[3] == 'videos') {

    // Store on server in videos folder (not content/images/videos)
    const PATH = path.resolve(__dirname + FILENAME.replace('/content/images',''))
    //const PATH = __dirname + '/watermarked_video.mp4'
    //console.log(PATH)

    const tempFilename = path.basename(ORIGINAL_VIDEO)
    console.log("tempfile",tempFilename)
    // check if already procesing
    if (fs.existsSync(__dirname + tempFilename)) {
      console.log('Already processing, please wait: ', tempFilename);
      // redirect to original while video is processing - the next request to this video will show watermarked video (if completed)
      console.log('Redirect to original video while video is processing');
      res.redirect(ORIGINAL_VIDEO)
    } else {// start processing the file

      (async () => {

        // Check if file exists on server
        if (fs.existsSync(PATH)) {
            console.log('File exists and adready processed',tempFilename)
            res.sendFile(PATH) // file already exists, send file
        } else { // file does not exist, generate watermarked video

          // The path of the downloaded file on our machine
          const localFilePath = path.resolve(__dirname, tempFilename)
          console.log('localFilePath ', localFilePath)
          console.log('Downloading file: ', tempFilename)
          try {
            const response = await axios({
              method: 'GET',
              url: ORIGINAL_VIDEO,
              responseType: 'stream',
            })

            const w = response.data.pipe(fs.createWriteStream(localFilePath))
            w.on('finish', () => {
              console.log('Successfully downloaded file: ', tempFilename)

              try {

                console.log('Processing file: ', tempFilename)
                var process = new ffmpeg(tempFilename)
                process.then(function (video) {
                  // Callback mode

                    // create watermarked video
                  video.fnAddWatermark(LOGO, PATH, {
                    position : 'C'
                  }, function (error, file) {

                    console.log('Successfully delete temp file: ' + tempFilename)
                    fs.unlinkSync(tempFilename) // delete temp file

                    if (!error) {
                      console.log('Successfully processed file: ' + file)
                      res.sendFile(PATH)
                    } else {
                      console.log('Error: ', error)
                      fs.unlink(PATH) // delete file
                      fs.unlink(tempFilename) // delete file
                      
                    }
                  });
                }, function (err) {
                  console.log('Error: ' + err)
                  fs.unlink(PATH) // delete file
                  fs.unlink(tempFilename) // delete file
                });

              } catch (e) {
              	console.log(e.code)
              	console.log(e.msg)
                fs.unlink(PATH) // delete file
                fs.unlink(tempFilename) // delete file
              }

            });
          } catch (err) {
            throw new Error(err)
          }

        }

      })();

    }

  } else { // not acceptable fileformat
    res.status(404).send('Not Found !!!')
  }

})

app.listen(port)
console.log('Listening on port ' + port)

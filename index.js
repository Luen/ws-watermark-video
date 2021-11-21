const express = require('express')
const fs = require('fs')
const path = require('path')
const axios = require("axios")
const ffmpeg = require("ffmpeg")

const app = express()
const port = process.env.PORT || 8090

app.get('*', function(req, res) {

  const FILENAME = escape(req.url)

  const ORIGINAL_VIDEO = "https://wanderstories.space" + FILENAME

  const FILE_EXTENSION = ORIGINAL_VIDEO.split('.').pop().toLowerCase()

  const LOGO = __dirname + "/Wanderstories-logo.png"
  //const LOGO = "./Wanderstories-logo.png"

  const ACCEPTED_FORMATS = [
    'mp4'
  ]

   // If an accepted file extensinon && path is /content/images/videos
  if (ACCEPTED_FORMATS.indexOf(FILE_EXTENSION) >= 0 && FILENAME.split('/')[1] == 'content' && FILENAME.split('/')[2] == 'images' && FILENAME.split('/')[3] == 'videos') {

    // Store on server in videos folder (not content/images/videos)
    const PATH = __dirname + FILENAME.replace('/content/images','')
    //const PATH = __dirname + '/watermarked_video.mp4'
    //console.log(PATH)

    const tempFilename = path.basename(ORIGINAL_VIDEO)

    // check if already procesing
    if (fs.existsSync(__dirname + tempFilename)) {
      console.log('Already processing, please wait: ', tempFilename);
      // redirect to original while video is processing - the next request to this video will show watermarked video
      console.log('Redirect to original video while video is processing');
      res.redirect(ORIGINAL_VIDEO)
    } else {// start processing the file

      (async () => {

        // Check if file exists on server
        if (fs.existsSync(PATH)) {
            res.sendFile(PATH) // file already exists, send file
        } else { // file does not exist, generate watermarked video

          // The path of the downloaded file on our machine
          const localFilePath = path.resolve(__dirname, tempFilename)
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
                    }
                  });
                }, function (err) {
                  console.log('Error: ' + err)
                });

              } catch (e) {
              	console.log(e.code)
              	console.log(e.msg)
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

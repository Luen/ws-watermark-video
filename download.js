const fs = require('fs');
const path = require('path');
const axios = require("axios");

(async () => {

  const VIDEO_URL =
    'https://www.kindacode.com/wp-content/uploads/2021/01/example.mp4';
    // Get the file name
    const fileName = path.basename(VIDEO_URL);

    // The path of the downloaded file on our machine
    const localFilePath = path.resolve(__dirname, fileName);
    console.log(localFilePath)
    try {
      const response = await axios({
        method: 'GET',
        url: VIDEO_URL,
        responseType: 'stream',
      });

      const w = response.data.pipe(fs.createWriteStream(localFilePath));
      w.on('finish', () => {
        console.log('Successfully downloaded file!');
      });
    } catch (err) {
      throw new Error(err);
    }

})();

const Fs = require('fs');
const ffmpeg = require("ffmpeg");

(async () => {

  try {

    var video = await new ffmpeg("example.mp4")
    const LOGO = "Wanderstories-logo.png"
    const OUTPUT_PATH = "example-output.mp4"

    var settings = {
        position: "C", // Position: NE NC NW SE SC SW C CE CW
        margin_nord: null, // Margin nord
        margin_sud: null, // Margin sud
        margin_east: null, // Margin east
        margin_west: null // Margin west
    }

    // create watermarked video
    await video.fnAddWatermark(LOGO, OUTPUT_PATH, settings)

    //res.sendFile(PATH)

/*
    	var process = new ffmpeg('example.mp4');
    	process.then(function (video) {
    		// Callback mode
    		video.fnAddWatermark('Wanderstories-logo.png', 'watermarked_video.mp4', {
    			position : 'SE'
    		}, function (error, file) {
    			if (!error)
    				console.log('New video file: ' + file);
    		});
    	}, function (err) {
    		console.log('Error: ' + err);
    	});
*/

//https://stackoverflow.com/questions/30999052/how-to-show-watermark-in-real-time-with-ffmpeg-by-node-js-angular-js


//https://www.npmjs.com/package/ffmpeg
/*
      var process = new ffmpeg('example.mp4');

      process.then(function (video) {
          // console.log('The video is ready to be processed');

          var watermarkPath = 'Wanderstories-logo.png',
              newFilepath = 'test.mp4',
              settings = {
                  position        : "SC"      // Position: NE NC NW SE SC SW C CE CW
                  , margin_nord     : null      // Margin nord
                  , margin_sud      : null      // Margin sud
                  , margin_east     : null      // Margin east
                  , margin_west     : null      // Margin west
              };
          var callback = function (error, files) {
              if(error){
                  console.log('ERROR: ', error);
              }
              else{
                  // console.log('TERMINOU', files);
                  //res.send('/'+name)
                  console.log("done");
              }
          }

          //add watermark
          video.fnAddWatermark(watermarkPath, newFilepath, settings, callback)

      }, function (err) {
          console.log('Error: ' + err);
      });
*/

  } catch (e) {
  	console.log(e.code);
  	console.log(e.msg);
  }

})();

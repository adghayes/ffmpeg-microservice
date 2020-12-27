const ffmpeg = require('fluent-ffmpeg')
const fetch = require('node-fetch')

const addOutputs = require('./addOutputs.js')
const addInput = require('./addInput.js')
const cloneDeep = require('lodash.clonedeep')
const { peakInput, PeakFinder } = require('./lib/peaks.js')
const uploadAll = require('./upload')

ffmpeg.setFfmpegPath(process.env.BINARY_DIR + 'ffmpeg')

// returns a promise for the transcoding
function transcodingPromise(command, event){
    return new Promise((resolve, reject) => {
        command
            .on('start', commandLine => console.log(`begin transcoding: ${commandLine}`))
            .on('progress', progress => console.log(`transcoded ${progress.targetSize}KB`))
            .on('error', (err) => reject(err))
            .on('codecData', data => {
                event.input.probe = data
                console.log(`input codec info: ${data}`)
            })
            .on('end', () => {
                console.log('transcoding successful')
                resolve()
            })
            .run()
    })
}

function callback(callback, body){
    if(!callback.url) throw new Error('no callback url')

    return fetch(callback.url, {
        method: callback.method || 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...callback.headers
        },
        body: JSON.stringify(body)
    })
}

module.exports = async (event) => {
    const command = ffmpeg()
    try {
        validateUploads(event.outputs)
        const outputs = cloneDeep(event.outputs)
        let peaksCount
        if (event.peaks && event.peaks.count){
            peaksCount = event.peaks.count
            outputs.push(peakInput(event.peaks.quality))
        }
        const outputFilenames = addOutputs(command, outputs)

        await addInput(command, event.input)
        await transcodingPromise(command, event)
        const uploads = uploadAll(outputFilenames, event.outputs)

        if (peaksCount){
            const rawFilename = outputFilenames[outputFilenames.length - 1]
            let peaks = (new PeakFinder(peaksCount)).getPeaks(rawFilename)
            callbackBody.peaks = await peaks
        }
        
        return Promise.all(uploads)
            .then(() => {
                callbackBody.status = 200
                if(event.callback) return callback(event.callback, callbackBody)
            })

    } catch(e) {
        callbackBody.status = 422
        return callback(event.callback, callbackBody)
    }
}

#!/usr/bin/env node

const fs        = require('fs');
const os        = require('os');
const path      = require('path');

const speedTest = require('speedtest-net');
const moment    = require('moment');
const Promise   = require('bluebird').Promise;
const ping      = require('ping');
const async     = require('async');
const charm     = require('charm')();
const pack      = require('./package.json');
require('colors');

// CLI args (view csv location, view contents, empty the file)
let argv = process.argv;
switch(argv[2]) {
  case 'loc':
    console.log(csvFile());
    process.exit();
    break;
  case 'view':
    charm.pipe(process.stdout);
    charm.reset();
    console.log(fs.readFileSync(csvFile(), 'utf8'));
    process.exit();
    break;
  case 'empty':
    fs.unlinkSync(csvFile());
    addData();
    process.exit();
    break;
};

// Charm control stdout
charm.pipe(process.stdout);
charm.reset();
charm.cursor(false);
process.on('SIGINT', () => {
  clearInterval(main);
  charm.cursor(true);
  process.exit();
});

let stats = {
  timer: 0,
  latency: 0,
  up: 0,
  down: 0,
  hup: 0,
  hdown: 0,
  status: 'idle'.green,
  tests: 0,
  uptime: 0,
  avg: {
    latency: 0,
    up: 0,
    down: 0,
    hup: 0,
    hdown: 0
  }
};

// Hold data for avg stats
let data = {
  latency: [],
  up: [],
  down: [],
  hup: [],
  hdown: []
};

// Create CSV file if it doesn't exist
addData();

// Start main loop
loop();

let main = setInterval(loop, 1000);

function loop() {
  // Erase screen
  charm.erase('screen');
  charm.position(0,0)

  console.log(`${pack.name} | Version ${pack.version}`);
  console.log(`Status: ${stats.status}`);
  console.log(`Seconds until next test: ${stats.timer}`);
  console.log(`Total tests: ${stats.tests}`);

  let fmt = moment.duration(stats.uptime*1000);
  console.log(`Uptime: ${fmt.days()}:${fmt.hours()}:${fmt.minutes()}:${fmt.seconds()}\n`);

  console.log(`Last test results:`);
  console.log(`------------------\n`);
  console.log(`Latency: ${checkNegative(stats.latency)} ms`);
  console.log(`Speed:`);
  console.log(`   Down: ${checkNegative(stats.down)}\t(${checkNegative(stats.hdown)} Mb)\n   Up:   ${checkNegative(stats.up)}\t(${checkNegative(stats.hup)} Mb)\n\n`);
  console.log(`Avg test results:`);
  console.log(`------------------\n`);
  console.log(`Latency: ${stats.avg.latency} ms`);
  console.log(`Speed:`);
  console.log(`   Down: ${stats.avg.down}\t(${stats.avg.hdown} Mb)\n   Up:   ${stats.avg.up}\t(${stats.avg.hup} Mb)\n\n`);

  // Run tests every minute
  if (stats.timer-- === 0) {
    runTests();
    stats.timer = 59;
  }

  stats.uptime++;
}

function runTests() {
  async.series([
    cb => {
      stats.status = "Starting tests".yellow;
      setTimeout(cb, 2000)
    },

    cb => {
      stats.status = "Running latency test...".cyan;
      pingtest().then(result => {
        stats.latency = result;
        data.latency.push(Number(result));

        stats.status = "Finished latency test".green;
        setTimeout(cb, 2000);
      }, () => {
        stats.latency = -1;

        stats.status = "Error, latency test failed!".red;
        setTimeout(cb, 2000);
      });
    },

    cb => {
      stats.status = "Running speed test...".cyan;
      speedtest().then(result => {
        stats.up   = result.speeds.originalUpload;
        stats.down = result.speeds.originalDownload;
        stats.hup   = result.speeds.upload;
        stats.hdown = result.speeds.download;

        data.up.push(result.speeds.originalUpload);
        data.down.push(result.speeds.originalDownload);
        data.hup.push(result.speeds.upload);
        data.hdown.push(result.speeds.download);

        stats.status = "Finished speed test".green;
        setTimeout(cb, 2000);
      }, () => {
        stats.up   = -1;
        stats.down = -1;
        stats.hup   = -1;
        stats.hdown = -1;

        stats.status = "Error, speed test failed!".red;
        setTimeout(cb, 2000);
      });
    }
  ], () => {
    addData(`${new Date().getTime()},${stats.latency},${stats.down},${stats.up}\n`);
    stats.tests++;
    stats.avg.latency = avg(data.latency)
    stats.avg.up      = avg(data.up)
    stats.avg.down    = avg(data.down)
    stats.avg.hup     = avg(data.hup)
    stats.avg.hdown   = avg(data.hdown)

    stats.status = "idle".green;
  });
}

function speedtest() {
  let start = new Date().getTime();
  return new Promise((resolve, reject) => {
    let test = speedTest({
      maxTime: 7500,
      pingCount: 2,
      maxServers: 2,

    });

    let timeout = setInterval(() => {
      if (new Date().getTime() - start >= 45000) {
        clearInterval(timeout);
        reject('timeout_error');
      }
    }, 1000);

    test.on('data', function(data) {
      clearInterval(timeout);
      resolve(data);
    });

    test.on('error', function(err) {
      clearInterval(timeout);
      reject(err);
    });
  })
}

function pingtest() {
  return new Promise((resolve, reject) => {
    ping.promise.probe('google.com', {
      timeout: 10,
      extra: ["-c 10"],
    }).then(res => {
      if (!res.alive) return reject("no_internet");
      let line = res.output.split('\n').slice(-2, -1)[0];
      resolve(line.match(/\=.*?\/(\d+.\d+)/)[1]);
    }, err => {
      reject(err);
    });
  });
}

function csvFile() {
  return os.tmpdir() + path.sep + "frontiersucks.csv";
}

function addData(append=null) {
  let csv = csvFile();

  // See if file exists. If it doesn't, create and add csv headers to top
  if (append === null) {
    try {
      fs.readFileSync(csv);
    } catch(e) {
      fs.writeFileSync(csv, "date,latency,down,up\n");
    }

  // Append info to end of csv
  } else {
    fs.appendFileSync(csv, append);
  }
}

function avg(arr) {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
  }
  return (sum/arr.length).toFixed(3);
}

function checkNegative(str) {
  str = String(str);
  if (str === "-1") return str.red;
  else return str;
}

import cluster, {Worker} from 'cluster'
import * as os from 'os'

const Gateway = require('./gateway')
const Networking = require('./networking');
const NetworkingIpc = require('./networking/ipc');
const SharedMemory = require('./common/shared-memory')
const { parseBool } = require('./utils/helpers')


let clusterCount = 1;
if(parseBool(process.env.CLUSTER_MODE)) {
  if(process.env.CLUSTER_COUNT) {
    clusterCount = parseInt(process.env.CLUSTER_COUNT);
  }
  else{
    clusterCount = os.cpus().length;
  }
}

type ApplicationDictionary = {[index: number]: Worker}

const applicationWorkers:ApplicationDictionary = {};

function runNewApplicationCluster(): Worker {
  const child:Worker = cluster.fork();//{MASTER_PROCESS_ID: process.pid}
  // @ts-ignore
  applicationWorkers[child.process.pid] = child
  return child;
}

async function boot() {
  if (cluster.isPrimary) {
    console.log(`Master cluster start at [${process.pid}]`)
    SharedMemory.startServer();

    /** Start gateway */
    Gateway.start({
      host: process.env.GATEWAY_HOST,
      port: process.env.GATEWAY_PORT,
    })

    await Networking.start()
    //
    cluster.on("exit", async function (worker, code, signal) {
      console.log(`Worker ${worker.process.pid} died with code: ${code}, and signal: ${signal}`);
      // @ts-ignore
      delete applicationWorkers[worker.process.pid];
      await NetworkingIpc.reportClusterStatus(worker.process.pid, 'exit')

      console.log("Starting a new worker");
      let child = runNewApplicationCluster();
      await NetworkingIpc.reportClusterStatus(child.process.pid, 'start')
    });

    /** Start application clusters */
    for (let i = 0; i < clusterCount; i++) {
      const child:Worker|null = runNewApplicationCluster();
      if(!child){
        i--;
        console.log(`child process fork failed. trying one more time`);
      }
      await NetworkingIpc.reportClusterStatus(child.process.pid, 'start')
    }
  } else {
    console.log(`application cluster start pid:${process.pid}`)
    require('./core').start();
  }
}

boot();

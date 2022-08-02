import CallablePlugin from './base/callable-plugin'
import {remoteApp, remoteMethod, ipcMethod} from './base/app-decorators'
import {IpcCallOptions} from "../../common/types";
const {timeout} = require('../../utils/helpers')
const NodeCache = require('node-cache');
const coreIpc = require('../../core/ipc')

const tasksCache = new NodeCache({
  stdTTL: 6*60, // Keep distributed keys in memory for 6 minutes
  // /**
  //  * (default: 600)
  //  * The period in seconds, as a number, used for the automatic delete check interval.
  //  * 0 = no periodic check.
  //  */
  checkperiod: 60,
  useClones: false,
});

@remoteApp
class NetworkIpcHandler extends CallablePlugin {

  clustersPids: {[pid: string]: number} = {};

  async onStart() {
    super.onStart()

    this.network.once('peer:connect', async (peerId) => {
      await timeout(5000);
    })
  }

  get collateralPlugin() {
    return this.network.getPlugin('collateral');
  }

  get remoteCallPlugin() {
    return this.network.getPlugin('remote-call');
  }

  @ipcMethod("get-online-peers")
  async __onGetOnlinePeers() {
    return Object.keys(this.collateralPlugin.onlinePeers);
  }

  @ipcMethod("get-collateral-info")
  async __onIpcGetCollateralInfo(data={}, callerInfo) {
    // console.log(`NetworkIpcHandler.__onIpcGetCollateralInfo`, data, callerInfo);
    const collateralPlugin = this.network.getPlugin('collateral');
    await collateralPlugin.waitToLoad();

    let {groupInfo, networkInfo, peersWallet, walletsPeer} = collateralPlugin;
    return {groupInfo, networkInfo, peersWallet, walletsPeer}
  }

  @ipcMethod("broadcast-message")
  async __onBroadcastMessage(data) {
    // console.log("NetworkIpcHandler.__onBroadcastMessage", data);
    this.broadcast(data);
    return "Ok"
  }

  async onBroadcastReceived(data={}, callerInfo) {
    // console.log('NetworkIpcHandler.onBroadcastReceived', data, callerInfo);
    return await coreIpc.broadcast({
      data,
      callerInfo: {
        wallet: callerInfo.wallet,
        peerId: callerInfo.peerId._idB58String
      }
    })
  }

  assignTaskToProcess(taskId: string, pid: number) {
    tasksCache.set(taskId, pid);
  }

  takeRandomProcess(): number {
    let pList = Object.values(this.clustersPids);
    const index = Math.floor(Math.random() * pList.length)
    return pList[index]
  }

  getTaskProcess(taskId: string): number {
    return tasksCache.get(taskId);
  }

  @ipcMethod('report-cluster-status')
  async __reportClusterStatus(data: {pid: number, status: "start" | "exit"}) {
    // console.log("NetworkIpcHandler.__reportClusterStatus", {data,callerInfo});
    let {pid, status} = data
    switch (status) {
      case "start":
        this.clustersPids[pid] = pid
        break;
      case "exit":
        delete this.clustersPids[pid];
        break;
    }
    // console.log("NetworkIpcHandler.__reportClusterStatus", this.clustersPids);
  }

  @ipcMethod('get-leader')
  async __getLeader(data: any, callerInfo) {
    let leaderPlugin = this.network.getPlugin('group-leader')
    await leaderPlugin.waitToLeaderSelect();
    return leaderPlugin.leader;
  }

  clusterPermissions = {};
  @ipcMethod('ask-cluster-permission')
  async __askClusterPermission(data, callerInfo) {
    // every 20 seconds one process get permission to do election
    if(
      (!this.clusterPermissions[data?.key])
      || (Date.now() - this.clusterPermissions[data?.key] > data.expireTime)
    ){
      this.clusterPermissions[data?.key] = Date.now()
      return true
    }
    else
      return false;
  }

  /**
   * assign a task to caller process
   * @param data
   * @param data.taskId - ID of task for assign to caller
   * @param callerInfo
   * @param callerInfo.pid - process ID of caller
   * @param callerInfo.uid - unique id of call
   * @returns {Promise<string>}
   * @private
   */
  @ipcMethod('assign-task')
  async __assignTaskToProcess(data, callerInfo) {
    if(Object.keys(this.clustersPids).length < 1)
      throw {message: "No any online cluster"}
    this.assignTaskToProcess(data?.taskId, callerInfo.pid);
    return 'Ok';
  }

  /**
   *
   * @param data {Object}         - remote call arguments
   * @param data.peer {String}    - PeerID of remote peer
   * @param data.method {String}  - method to call
   * @param data.params {Object}  - remote method arguments
   * @param data.options {Object} - remote call options
   * @returns {Promise<[any]>}
   * @private
   */
  @ipcMethod("remote-call")
  async __onRemoteCallRequest(data) {
    // console.log(`NetworkIpcHandler.__onRemoteCallRequest`, data);
    const peer = await this.findPeer(data?.peer);
    return await this.remoteCall(peer, "exec-ipc-remote-call", data, data?.options);
  }

  /**
   *
   * @param data {Object}
   * @param data.peer {string}
   * @param data.method {string}
   * @param data.params {Object}
   * @param data.options {Object}
   * @param data.options.timeout {number}
   * @param data.options.timeoutMessage {string}
   * @param data.options.taskId {string}
   * @param callerInfo
   * @returns {Promise<*>}
   * @private
   */
  @remoteMethod("exec-ipc-remote-call")
  async __onIpcRemoteCallExec(data, callerInfo) {
    // console.log(`NetworkIpcHandler.__onIpcRemoteCallExec`, data);
    let taskId, options: IpcCallOptions = {};
    if(data?.options?.taskId){
      taskId = data?.options.taskId;
      if(tasksCache.has(taskId)) {
        options.pid = tasksCache.get(data.options.taskId);
      }
      else{
        options.pid = this.takeRandomProcess()
        this.assignTaskToProcess(taskId, options.pid);
      }
    }
    return await coreIpc.call(
      "forward-remote-call",
      {
        data,
        callerInfo: {
          wallet: callerInfo.wallet,
          peerId: callerInfo.peerId._idB58String
        }
      },
      options);
  }
}

export default NetworkIpcHandler;

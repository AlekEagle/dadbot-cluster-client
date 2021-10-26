/// <reference types="node" />
import EventEmitter from 'events';
import {
  GenericCloseCodes,
  ClientService,
  GenericOptions,
  DataTypes
} from '../index.d';
export interface WSOptions {
  url: string;
}
export default class WSService extends EventEmitter implements ClientService {
  name: string;
  private token;
  private client;
  serviceOptions: WSOptions;
  options: GenericOptions;
  sendData(type: DataTypes, data: any): Promise<void>;
  disconnect(code: GenericCloseCodes): void;
  private __disconnect;
  startCCC(
    to: number | 'all',
    data: string
  ): Promise<{
    id: string;
    data: string | string[];
  }>;
  constructor(
    token: string,
    options: GenericOptions,
    serviceOptions: WSOptions
  );
  connect(): Promise<void>;
  private handleHeartbeat;
  private handleServerPayload;
}
export declare enum ServerOpCodes {
  Heartbeat = 0,
  Identify = 1,
  DataOK = 2,
  CCCPropagate = 3,
  CCCReturn = 4,
  CCCConfirm = 5,
  ClusterStatus = 6,
  DataPushed = 7
}
export declare enum WSServerCloseCode {
  Normal = 1000,
  NoStatus = 1005,
  Abnormal = 1006,
  ServerError = 1011,
  ServiceRestart = 1012,
  BadGateway = 1014,
  UnknownError = 4000,
  InvalidOpcode = 4001,
  DecodeError = 4002,
  NotAuthenticated = 4003,
  AuthenticationFailed = 4004,
  AlreadyAuthenticated = 4005,
  HeartbeatTimeout = 4006,
  Ratelimited = 4008,
  InvalidCluster = 4010,
  InvalidClusterCount = 4011,
  invalidCCCID = 4012
}
export declare enum WSClientCloseCode {
  Normal = 1000,
  GoingAway = 1001,
  NoStatus = 1005,
  Abnormal = 1006
}
export declare enum ClientOpCodes {
  Heartbeat = 0,
  Identity = 1,
  SendData = 2,
  CCCBegin = 3,
  CCCReturn = 4
}
export interface PayloadStructure<T> {
  op: ServerOpCodes | ClientOpCodes;
  d?: T;
}
export declare namespace ServerStructures {
  interface Heartbeat {}
  interface Identify {
    heartbeatTimeout: number;
    schema: any;
  }
  interface DataACK {
    success: boolean;
  }
  interface CCCPropagate {
    id: string;
    data: string;
  }
  interface CCCReturn {
    id: string;
    from: number | 'all';
    data: string;
  }
  interface CCCConfirm {
    id: string;
  }
  interface ClusterStatus {
    count: number;
    connected: number[];
  }
  interface DataPushed {}
}
export declare namespace ClientStructures {
  interface Heartbeat {}
  interface Identity {
    token: string;
    clusters: number;
    cluster: number;
  }
  interface SendData {
    type: DataTypes;
    data: any;
  }
  interface CCCBegin {
    to: number | 'all';
    data: string;
  }
  interface CCCReturn {
    id: string;
    data: string;
  }
}

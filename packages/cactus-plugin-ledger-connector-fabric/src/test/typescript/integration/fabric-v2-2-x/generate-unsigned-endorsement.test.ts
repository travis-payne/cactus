import http from "http";
import { AddressInfo } from "net";

import test, { Test } from "tape-promise/tape";
import { v4 as uuidv4 } from "uuid";

import bodyParser from "body-parser";
import express from "express";

import { pruneDockerAllIfGithubAction } from "@hyperledger/cactus-test-tooling";
import { PluginRegistry } from "@hyperledger/cactus-core";

import {
  IListenOptions,
  LogLevelDesc,
  Servers,
} from "@hyperledger/cactus-common";

import {
  PluginLedgerConnectorFabric,
  DefaultApi as FabricApi,
  DefaultEventHandlerStrategy,
  FabricSigningCredentialType,
} from "../../../../main/typescript/public-api";

import { IPluginLedgerConnectorFabricOptions } from "../../../../main/typescript/plugin-ledger-connector-fabric";
import { DiscoveryOptions, Wallets } from "fabric-network";
import { Configuration } from "@hyperledger/cactus-core-api";
import Utils from "../../utils/utils";
import { Endorsement } from "fabric-common";

/**
 * Use this to debug issues with the fabric node SDK
 * ```sh
 * export HFC_LOGGING='{"debug":"console","info":"console"}'
 * ```
 */

const testCase = "runs tx on a Fabric v2.2.0 ledger";
const logLevel: LogLevelDesc = "TRACE";

test("BEFORE " + testCase, async (t: Test) => {
  const pruning = pruneDockerAllIfGithubAction({ logLevel });
  await t.doesNotReject(pruning, "Pruning didn't throw OK");
  t.end();
});

test(testCase, async (t: Test) => {
  const logLevel: LogLevelDesc = "TRACE";

  const mspOrg1 = "Org1MSP";
  const serviceUserId = "service";

  const ccp = Utils.buildCCPOrg1() as any;

  const caClient = Utils.buildCAClient(ccp, "ca.org1.example.com");

  const wallet = await Wallets.newInMemoryWallet();

  // const adminIdentity = await Utils.enrollAdmin(caClient, wallet, mspOrg1);

  // // in a real application this would be done only when a new user was required to be added
  // // and would be part of an administrative flow
  const serviceUserIdentity = await Utils.registerAndEnrollUser(
    caClient,
    wallet,
    mspOrg1,
    serviceUserId,
    "org1.department1",
  );

  const sshConfig = {};

  const pluginRegistry = new PluginRegistry({ plugins: [] });

  const discoveryOptions: DiscoveryOptions = {
    enabled: true,
    asLocalhost: true,
  };

  const pluginOptions: IPluginLedgerConnectorFabricOptions = {
    instanceId: uuidv4(),
    pluginRegistry,
    sshConfig,
    cliContainerEnv: {},
    peerBinary: "/fabric-samples/bin/peer",
    logLevel,
    connectionProfile: ccp,
    discoveryOptions,
    eventHandlerOptions: {
      strategy: DefaultEventHandlerStrategy.NetworkScopeAllfortx,
      commitTimeout: 300,
    },
  };
  const plugin = new PluginLedgerConnectorFabric(pluginOptions);

  const expressApp = express();
  expressApp.use(bodyParser.json({ limit: "250mb" }));
  const server = http.createServer(expressApp);
  const listenOptions: IListenOptions = {
    hostname: "localhost",
    port: 0,
    server,
  };
  const addressInfo = (await Servers.listen(listenOptions)) as AddressInfo;
  test.onFinish(async () => await Servers.shutdown(server));
  const { address, port } = addressInfo;
  const apiHost = `http://${address}:${port}`;
  t.comment(
    `Metrics URL: ${apiHost}/api/v1/plugins/@hyperledger/cactus-plugin-ledger-connector-fabric/get-prometheus-exporter-metrics`,
  );

  const apiConfig = new Configuration({ basePath: apiHost });
  const apiClient = new FabricApi(apiConfig);

  await plugin.getOrCreateWebServices();
  await plugin.registerWebServices(expressApp);

  const unsignedEndorsement = await apiClient.generateUnsignedProposal({
    channelName: "mychannel",
    chaincodeName: "basic",
    functionName: "GetAllAssets",
    functionArgs: [],
    signingCredential: {
      type: FabricSigningCredentialType.None,
    },
    serviceUserIdentity: JSON.stringify(serviceUserIdentity),
    serviceUserName: "service",
  });

  t.ok(unsignedEndorsement);
  t.ok(unsignedEndorsement.data);
  t.equal(unsignedEndorsement.status, 200);

  const endorsement: Endorsement = (unsignedEndorsement.data as any)
    .endorsement;
  const proposalBytes = (unsignedEndorsement.data as any).proposalBytes;

  // If I try and sign this with "adminIdentity", it chucks an access denied error.
  const sigA = Utils.hashAndSignProposal(
    proposalBytes,
    serviceUserIdentity.credentials.privateKey,
  );
  const signatureA: Buffer = Utils.preventMalleability(sigA);

  const commitResponse = await apiClient.sendSignedEndorsement({
    signingCredential: {
      type: FabricSigningCredentialType.None,
    },
    serviceUserIdentity: JSON.stringify(serviceUserIdentity),
    serviceUserName: "service",
    endorsement,
    signedProposal: signatureA,
    channelName: "mychannel",
    organisation: "Org1",
  });

  t.ok(commitResponse);
  t.equal(commitResponse.status, 200);

  t.end();
});

test("AFTER " + testCase, async (t: Test) => {
  const pruning = pruneDockerAllIfGithubAction({ logLevel });
  await t.doesNotReject(pruning, "Pruning didn't throw OK");
  t.end();
});

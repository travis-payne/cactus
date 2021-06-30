import test, { Test } from "tape-promise/tape";
import { v4 as uuidv4 } from "uuid";

import {
  FabricTestLedgerV1,
  pruneDockerAllIfGithubAction,
} from "@hyperledger/cactus-test-tooling";
import { PluginRegistry } from "@hyperledger/cactus-core";

import { LogLevelDesc } from "@hyperledger/cactus-common";

import { ChannelPeer, Peer } from "fabric-client";

import { PluginKeychainMemory } from "@hyperledger/cactus-plugin-keychain-memory";

import {
  DefaultEventHandlerStrategy,
  FabricSigningCredential,
  FabricSigningCredentialType,
  ConnectionProfile,
} from "../../../../main/typescript/public-api";

import {
  DefaultEventHandlerOptions,
  DefaultEventHandlerStrategies,
  DiscoveryOptions,
  Gateway,
  GatewayOptions,
  InMemoryWallet,
  X509WalletMixin,
} from "fabric-network";

const elliptic = require("elliptic");
const { KEYUTIL } = require("jsrsasign");

const { SHA256 } = require("sha2");

/**
 * Use this to debug issues with the fabric node SDK
 * ```sh
 * export HFC_LOGGING='{"debug":"console","info":"console"}'
 * ```
 */

const testCase = "runs tx on a Fabric v1.4.8 ledger";
const logLevel: LogLevelDesc = "TRACE";

// test.onFailure(async () => {
//   await Containers.logDiagnostics({ logLevel });
// });

test("BEFORE " + testCase, async (t: Test) => {
  const pruning = pruneDockerAllIfGithubAction({ logLevel });
  await t.doesNotReject(pruning, "Pruning didn't throw OK");
  t.end();
});

test(testCase, async (t: Test) => {
  const ledger = new FabricTestLedgerV1({
    emitContainerLogs: true,
    publishAllPorts: true,
    logLevel,
    imageName: "hyperledger/cactus-fabric2-all-in-one",
    imageVersion: "2021-04-20-nodejs",
    envVars: new Map([
      ["FABRIC_VERSION", "2.2.0"],
      ["CA_VERSION", "1.4.9"],
    ]),
  });

  const tearDownLedger = async () => {
    await ledger.stop();
    await ledger.destroy();
  };
  test.onFinish(tearDownLedger);

  await ledger.start();

  const enrollAdminOut = await ledger.enrollAdmin();
  const adminWallet = enrollAdminOut[1];
  const [userIdentity] = await ledger.enrollUser(adminWallet);

  const connectionProfile = await ledger.getConnectionProfileOrg1();

  // const sshConfig = await ledger.getSshConfig();

  const keychainInstanceId = uuidv4();
  const keychainId = uuidv4();
  const keychainEntryKey = "user2";
  const keychainEntryValue = JSON.stringify(userIdentity);

  const keychainPlugin = new PluginKeychainMemory({
    instanceId: keychainInstanceId,
    keychainId,
    logLevel,
    backend: new Map([
      [keychainEntryKey, keychainEntryValue],
      ["some-other-entry-key", "some-other-entry-value"],
    ]),
  });

  const pluginRegistry = new PluginRegistry({ plugins: [keychainPlugin] });

  const discoveryOptions: DiscoveryOptions = {
    enabled: true,
    asLocalhost: true,
  };

  // const pluginOptions: IPluginLedgerConnectorFabricOptions = {
  //   instanceId: uuidv4(),
  //   pluginRegistry,
  //   peerBinary: "/fabric-samples/bin/peer",
  //   sshConfig,
  //   cliContainerEnv: {},
  //   logLevel,
  //   connectionProfile,
  //   discoveryOptions,
  //   eventHandlerOptions: {
  //     strategy: DefaultEventHandlerStrategy.NetworkScopeAllfortx,
  //     commitTimeout: 300,
  //   },
  // };
  // const plugin = new PluginLedgerConnectorFabric(pluginOptions);
  // const carId = "CAR277";
  // const carOwner = uuidv4();

  const signingCredential: FabricSigningCredential = {
    keychainId,
    keychainRef: keychainEntryKey,
    type: FabricSigningCredentialType.None,
  };

  // const res = await plugin.sendSignedProposal("mychannel");

  // console.log(res);

  // const res = await apiClient.runTransactionV1({
  //   signingCredential,
  //   channelName: "mychannel",
  //   contractName: "fabcar",
  //   invocationType: FabricContractInvocationType.Call,
  //   methodName: "queryAllCars",
  //   params: [],
  // } as RunTransactionRequest);
  // t.ok(res);
  // t.ok(res.data);
  // t.equal(res.status, 200);
  // t.doesNotThrow(() => JSON.parse(res.data.functionOutput));

  const gateway = new Gateway();
  const wallet = new InMemoryWallet(new X509WalletMixin());
  const keychain = pluginRegistry.findOneByKeychainId(keychainId);

  const fabricX509IdentityJson = await keychain.get<string>(
    signingCredential.keychainRef,
  );
  const identity = JSON.parse(fabricX509IdentityJson);

  await wallet.import(signingCredential.keychainRef, identity);

  const eventHandlerOptions: DefaultEventHandlerOptions = {
    commitTimeout: 300,
  };

  eventHandlerOptions.strategy =
    DefaultEventHandlerStrategies[
      DefaultEventHandlerStrategy.NetworkScopeAllfortx
    ];

  const gatewayOptions: GatewayOptions = {
    discovery: discoveryOptions,
    eventHandlerOptions,
    identity: signingCredential.keychainRef,
    wallet,
  };

  await gateway.connect(connectionProfile as ConnectionProfile, gatewayOptions);
  t.ok(gateway, "gateway connected successfully OK");

  const transactionProposal = {
    fcn: "queryAllCars",
    args: [],
    chaincodeId: "fabcar",
    channelId: "mychannel",
  };

  const network = await gateway.getNetwork("mychannel");
  t.ok(network, "network truthy OK");

  const channel = await network.getChannel();
  t.ok(channel, "channel truthy OK");

  const proposal = await channel.generateUnsignedProposal(
    transactionProposal,
    "Org1MSP",
    userIdentity.certificate,
    true,
  );

  const proposalBytes = (proposal as any).proposal.toBuffer(); // the proposal comes from step 1

  const digest = SHA256(proposalBytes); // A hash function by the user's desire

  const { prvKeyHex } = KEYUTIL.getKey(userIdentity.privateKey); // convert the pem encoded key to hex encoded private key

  const EC = elliptic.ec;
  const ecdsaCurve = elliptic.curves["p256"];

  const ecdsa = new EC(ecdsaCurve);
  const signKey = ecdsa.keyFromPrivate(prvKeyHex, "hex");
  const sig = ecdsa.sign(Buffer.from(digest, "hex"), signKey);

  const signature = Buffer.from(sig.toDER());
  const signedProposal = {
    signature,
    proposal_bytes: proposalBytes,
  };

  const channelPeers: ChannelPeer[] = channel.getChannelPeers();

  const targets: Peer[] = [];

  channelPeers.forEach((peer) => {
    targets.push(peer.getPeer());
  });

  const sendSignedProposalReq = {
    signedProposal: signedProposal as any,
    targets,
  };

  const proposalResponses = await channel.sendSignedProposal(
    sendSignedProposalReq,
  );
  const noErrorResponses = proposalResponses.every(
    (aProposalResponse) => !(aProposalResponse instanceof Error),
  );
  t.comment(JSON.stringify(proposalResponses, null, 2));
  t.true(noErrorResponses, "noErrorResponses true OK");

  //plugin.

  // const expressApp = express();
  // expressApp.use(bodyParser.json({ limit: "250mb" }));
  // const server = http.createServer(expressApp);
  // const listenOptions: IListenOptions = {
  //   hostname: "0.0.0.0",
  //   port: 0,
  //   server,
  // };
  // const addressInfo = (await Servers.listen(listenOptions)) as AddressInfo;
  // test.onFinish(async () => await Servers.shutdown(server));
  // const { address, port } = addressInfo;
  // const apiHost = `http://${address}:${port}`;
  // t.comment(
  //   `Metrics URL: ${apiHost}/api/v1/plugins/@hyperledger/cactus-plugin-ledger-connector-fabric/get-prometheus-exporter-metrics`,
  // );

  // const apiConfig = new Configuration({ basePath: apiHost });
  // const apiClient = new FabricApi(apiConfig);

  // await plugin.getOrCreateWebServices();
  // await plugin.registerWebServices(expressApp);

  // {
  //   const res = await apiClient.runTransactionV1({
  //     signingCredential,
  //     channelName: "mychannel",
  //     contractName: "fabcar",
  //     invocationType: FabricContractInvocationType.Call,
  //     methodName: "queryAllCars",
  //     params: [],
  //   } as RunTransactionRequest);
  //   t.ok(res);
  //   t.ok(res.data);
  //   t.equal(res.status, 200);
  //   t.doesNotThrow(() => JSON.parse(res.data.functionOutput));
  // }

  // {
  //   const req: RunTransactionRequest = {
  //     signingCredential,
  //     channelName: "mychannel",
  //     invocationType: FabricContractInvocationType.Send,
  //     contractName: "fabcar",
  //     methodName: "createCar",
  //     params: [carId, "Ford", "601", "Blue", carOwner],
  //   };

  //   const res = await apiClient.runTransactionV1(req);
  //   t.ok(res);
  //   t.ok(res.data);
  //   t.equal(res.status, 200);
  // }
  // {
  //   const res = await apiClient.runTransactionV1({
  //     signingCredential,
  //     channelName: "mychannel",
  //     contractName: "fabcar",
  //     invocationType: FabricContractInvocationType.Call,
  //     methodName: "queryAllCars",
  //     params: [],
  //   } as RunTransactionRequest);
  //   t.ok(res);
  //   t.ok(res.data);
  //   t.equal(res.status, 200);
  //   const cars = JSON.parse(res.data.functionOutput);
  //   const car277 = cars.find((c: { Key: string }) => c.Key === carId);
  //   t.ok(car277, "Located Car record by its ID OK");
  //   t.ok(car277.Record, `Car object has "Record" property OK`);
  //   t.ok(car277.Record.owner, `Car object has "Record"."owner" property OK`);
  //   t.equal(car277.Record.owner, carOwner, `Car has expected owner OK`);
  // }
  // {
  //   const res = await apiClient.getPrometheusExporterMetricsV1();
  //   const promMetricsOutput =
  //     "# HELP " +
  //     K_CACTUS_FABRIC_TOTAL_TX_COUNT +
  //     " Total transactions executed\n" +
  //     "# TYPE " +
  //     K_CACTUS_FABRIC_TOTAL_TX_COUNT +
  //     " gauge\n" +
  //     K_CACTUS_FABRIC_TOTAL_TX_COUNT +
  //     '{type="' +
  //     K_CACTUS_FABRIC_TOTAL_TX_COUNT +
  //     '"} 3';
  //   t.ok(res);
  //   t.ok(res.data);
  //   t.equal(res.status, 200);
  //   t.true(
  //     res.data.includes(promMetricsOutput),
  //     "Total Transaction Count of 3 recorded as expected. RESULT OK",
  //   );
  // }
  t.end();
});

test("AFTER " + testCase, async (t: Test) => {
  const pruning = pruneDockerAllIfGithubAction({ logLevel });
  await t.doesNotReject(pruning, "Pruning didn't throw OK");
  t.end();
});

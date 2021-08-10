import test, { Test } from "tape-promise/tape";
import { v4 as uuidv4 } from "uuid";

import Utils from "../../../../main/typescript/utils/utils";

import {
  FabricTestLedgerV1,
  pruneDockerAllIfGithubAction,
} from "@hyperledger/cactus-test-tooling";
import { PluginRegistry } from "@hyperledger/cactus-core";

import { LogLevelDesc } from "@hyperledger/cactus-common";

import { PluginKeychainMemory } from "@hyperledger/cactus-plugin-keychain-memory";

import {
  DefaultEventHandlerStrategy,
  FabricSigningCredential,
  FabricSigningCredentialType,
  ConnectionProfile,
  // IPluginLedgerConnectorFabricOptions,
  // PluginLedgerConnectorFabric,
  // SendSignedProposalRequest,
} from "../../../../main/typescript/public-api";

import {
  DefaultEventHandlerOptions,
  DefaultEventHandlerStrategies,
  DiscoveryOptions,
  Gateway,
  GatewayOptions as FabricGatewayOptions,
  // InMemoryWallet,
  // X509WalletMixin,
  Wallets,
} from "fabric-network";
import {
  Discoverer,
  DiscoveryService,
  Endorsement,
  // Endpoint,
  ProposalResponse,
} from "fabric-common";

// import { ProposalResponseObject } from "fabric-client";

const testCase = "runs tx on a Fabric v1.4.8 ledger";
const logLevel: LogLevelDesc = "TRACE";

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

  const serviceUserId = "service";
  const signingUserId = "user2";
  const channelName = "mychannel";
  // const organisation = "Org1MSP";

  const gateway = new Gateway();
  const discoveryOptions: DiscoveryOptions = {
    enabled: true,
    asLocalhost: true,
  };

  const eventHandlerOptions: DefaultEventHandlerOptions = {
    commitTimeout: 300,
  };

  eventHandlerOptions.strategy =
    DefaultEventHandlerStrategies[
      DefaultEventHandlerStrategy.NetworkScopeAllfortx
    ];

  const wallet = await Wallets.newInMemoryWallet();
  const keychainInstanceId = uuidv4();
  const keychainId = uuidv4();

  const enrollAdminOut = await ledger.enrollAdmin();
  const adminWallet = enrollAdminOut[1];

  const [signingUser] = await ledger.enrollUser(adminWallet, signingUserId);
  const [serviceUser] = await ledger.enrollUser(adminWallet, serviceUserId);

  const connectionProfile = await ledger.getConnectionProfileOrg1();

  // const sshConfig = await ledger.getSshConfig();

  const signingUserIdentity = JSON.stringify(signingUser);
  const serviceUserIdentity = JSON.stringify(serviceUser);

  const keychainPlugin = new PluginKeychainMemory({
    instanceId: keychainInstanceId,
    keychainId,
    logLevel,
    backend: new Map([
      [signingUserId, signingUserIdentity],
      [serviceUserId, serviceUserIdentity],
    ]),
  });

  const pluginRegistry = new PluginRegistry({ plugins: [keychainPlugin] });

  const signingCredential: FabricSigningCredential = {
    keychainId,
    keychainRef: signingUserId,
    type: FabricSigningCredentialType.None,
  };

  const keychain = pluginRegistry.findOneByKeychainId(keychainId);

  const fabricX509IdentityJson = await keychain.get<string>(
    signingCredential.keychainRef,
  );

  const identity = JSON.parse(fabricX509IdentityJson);

  await wallet.put(signingCredential.keychainRef, identity);

  const gatewayOptions: FabricGatewayOptions = {
    discovery: discoveryOptions,
    eventHandlerOptions,
    identity: signingCredential.keychainRef,
    wallet,
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

  await gateway.connect(connectionProfile as ConnectionProfile, gatewayOptions);
  t.ok(gateway, "gateway connected successfully OK");

  const network = await gateway.getNetwork(channelName);
  t.ok(network, "network truthy OK");

  const channel = await network.getChannel();
  t.ok(channel, "channel truthy OK");

  channel.client.getConnectionOptions();

  const provider = adminWallet
    .getProviderRegistry()
    .getProvider(signingUser.type);

  const signingUserContext = await provider.getUserContext(
    signingUser,
    signingUserId,
  );

  const discoverer: Discoverer = new Discoverer(
    "peer0.org1.example.com",
    channel.client,
    "Org1MSP",
  );

  const endpoint = channel.client.getEndorsers()[0].endpoint;
  // channel.client.
  // options.url = "grpc://localhost:7051";
  // // options.protocol = "grpcs";
  // const endpoint = new Endpoint(options);

  await discoverer.connect(endpoint);

  const discovery: DiscoveryService = await channel.newDiscoveryService(
    "discovery",
  );

  const idx = channel.client.newIdentityContext(signingUserContext);
  const endorsement: Endorsement = channel.newEndorsement("basic");

  discovery.build(idx, endorsement);
  discovery.sign(idx);

  const discovery_results = await discovery.send({
    targets: [discoverer],
    asLocalhost: true,
  });

  console.log(
    "\nDiscovery test 1 results :: " + JSON.stringify(discovery_results),
  );

  const build_options = { fcn: "GetAllAssets", args: [] };
  const proposalBytes = endorsement.build(idx, build_options);

  const sig = Utils.hashAndSignProposal(
    proposalBytes,
    signingUser.credentials.privateKey,
  );
  const signature = Utils.preventMalleability(sig);

  endorsement.sign(signature);

  const handler = await discovery.newHandler();

  const endorse_request = {
    handler: handler,
    requestTimeout: 30000,
  };

  const response: ProposalResponse = await endorsement.send(endorse_request);

  console.log(response);

  // {
  //   // Sending request without keychain service user

  //   const req: SendSignedProposalRequest = {
  //     channelName,
  //     data: signedProposal,
  //     serviceUserIdentity: serviceUserIdentity,
  //   };

  //   const proposalResponses: ProposalResponseObject = await plugin.sendSignedProposal(
  //     req,
  //   );

  //   const noErrorResponses = proposalResponses.every(
  //     (aProposalResponse) => !(aProposalResponse instanceof Error),
  //   );

  //   t.comment(JSON.stringify(proposalResponses));
  //   t.true(noErrorResponses, "noErrorResponses true OK");
  // }

  // {
  //   // Sending request with keychain service user
  //   const req: SendSignedProposalRequest = {
  //     channelName,
  //     data: signedProposal,
  //     signingCredential: {
  //       keychainId,
  //       keychainRef: serviceUserId,
  //       type: FabricSigningCredentialType.None,
  //     },
  //   };

  //   const proposalResponses: ProposalResponseObject = await plugin.sendSignedProposal(
  //     req,
  //   );

  //   const noErrorResponses = proposalResponses.every(
  //     (aProposalResponse) => !(aProposalResponse instanceof Error),
  //   );

  //   t.comment(JSON.stringify(proposalResponses));
  //   t.true(noErrorResponses, "noErrorResponses true OK");
  // }

  t.end();
});

test("AFTER " + testCase, async (t: Test) => {
  const pruning = pruneDockerAllIfGithubAction({ logLevel });
  await t.doesNotReject(pruning, "Pruning didn't throw OK");
  t.end();
});

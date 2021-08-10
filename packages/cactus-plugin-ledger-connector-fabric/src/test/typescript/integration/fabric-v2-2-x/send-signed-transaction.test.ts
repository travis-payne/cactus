// import test, { Test } from "tape-promise/tape";
// import { v4 as uuidv4 } from "uuid";

// import Utils from "../../../../main/typescript/utils/utils";

// import {
//   FabricTestLedgerV1,
//   pruneDockerAllIfGithubAction,
// } from "@hyperledger/cactus-test-tooling";
// import { PluginRegistry } from "@hyperledger/cactus-core";

// import { LogLevelDesc } from "@hyperledger/cactus-common";

// import { PluginKeychainMemory } from "@hyperledger/cactus-plugin-keychain-memory";

// import {
//   DefaultEventHandlerStrategy,
//   FabricSigningCredential,
//   FabricSigningCredentialType,
//   ConnectionProfile,
//   SendSignedProposalRequest,
//   IPluginLedgerConnectorFabricOptions,
//   PluginLedgerConnectorFabric,
// } from "../../../../main/typescript/public-api";

// import {
//   DefaultEventHandlerOptions,
//   DefaultEventHandlerStrategies,
//   DiscoveryOptions,
//   Gateway,
//   GatewayOptions,
//   InMemoryWallet,
//   X509WalletMixin,
// } from "fabric-network";

// import { ProposalResponseObject, ProposalResponse } from "fabric-client";

// const testCase = "runs tx on a Fabric v1.4.8 ledger";
// const logLevel: LogLevelDesc = "TRACE";

// test("BEFORE " + testCase, async (t: Test) => {
//   const pruning = pruneDockerAllIfGithubAction({ logLevel });
//   await t.doesNotReject(pruning, "Pruning didn't throw OK");
//   t.end();
// });

// test(testCase, async (t: Test) => {
//   const ledger = new FabricTestLedgerV1({
//     emitContainerLogs: true,
//     publishAllPorts: true,
//     logLevel,
//     imageName: "hyperledger/cactus-fabric2-all-in-one",
//     imageVersion: "2021-04-20-nodejs",
//     envVars: new Map([
//       ["FABRIC_VERSION", "2.2.0"],
//       ["CA_VERSION", "1.4.9"],
//     ]),
//   });

//   const tearDownLedger = async () => {
//     await ledger.stop();
//     await ledger.destroy();
//   };
//   test.onFinish(tearDownLedger);

//   await ledger.start();

//   const serviceUserId = "service";
//   const signingUserId = "user2";
//   const channelName = "mychannel";
//   const organisation = "Org1MSP";

//   const gateway = new Gateway();
//   const discoveryOptions: DiscoveryOptions = {
//     enabled: true,
//     asLocalhost: true,
//   };

//   const eventHandlerOptions: DefaultEventHandlerOptions = {
//     commitTimeout: 300,
//   };

//   eventHandlerOptions.strategy =
//     DefaultEventHandlerStrategies[
//       DefaultEventHandlerStrategy.NetworkScopeAllfortx
//     ];

//   const wallet = new InMemoryWallet(new X509WalletMixin());
//   const keychainInstanceId = uuidv4();
//   const keychainId = uuidv4();

//   const enrollAdminOut = await ledger.enrollAdmin();
//   const adminWallet = enrollAdminOut[1];

//   const [signingUser] = await ledger.enrollUser(adminWallet, signingUserId);
//   const [serviceUser] = await ledger.enrollUser(adminWallet, serviceUserId);

//   const connectionProfile = await ledger.getConnectionProfileOrg1();

//   const sshConfig = await ledger.getSshConfig();

//   const signingUserIdentity = JSON.stringify(signingUser);
//   const serviceUserIdentity = JSON.stringify(serviceUser);

//   const keychainPlugin = new PluginKeychainMemory({
//     instanceId: keychainInstanceId,
//     keychainId,
//     logLevel,
//     backend: new Map([
//       [signingUserId, signingUserIdentity],
//       [serviceUserId, serviceUserIdentity],
//     ]),
//   });

//   const pluginRegistry = new PluginRegistry({ plugins: [keychainPlugin] });

//   const signingCredential: FabricSigningCredential = {
//     keychainId,
//     keychainRef: signingUserId,
//     type: FabricSigningCredentialType.None,
//   };

//   const keychain = pluginRegistry.findOneByKeychainId(keychainId);

//   const fabricX509IdentityJson = await keychain.get<string>(
//     signingCredential.keychainRef,
//   );

//   const identity = JSON.parse(fabricX509IdentityJson);

//   await wallet.import(signingCredential.keychainRef, identity);

//   const gatewayOptions: GatewayOptions = {
//     discovery: discoveryOptions,
//     eventHandlerOptions,
//     identity: signingCredential.keychainRef,
//     wallet,
//   };

//   const pluginOptions: IPluginLedgerConnectorFabricOptions = {
//     instanceId: uuidv4(),
//     pluginRegistry,
//     peerBinary: "/fabric-samples/bin/peer",
//     sshConfig,
//     cliContainerEnv: {},
//     logLevel,
//     connectionProfile,
//     discoveryOptions,
//     eventHandlerOptions: {
//       strategy: DefaultEventHandlerStrategy.NetworkScopeAllfortx,
//       commitTimeout: 300,
//     },
//   };

//   const plugin = new PluginLedgerConnectorFabric(pluginOptions);

//   await gateway.connect(connectionProfile as ConnectionProfile, gatewayOptions);
//   t.ok(gateway, "gateway connected successfully OK");

//   const transactionProposal = {
//     fcn: "GetAllAssets",
//     args: [],
//     chaincodeId: "basic",
//     channelId: channelName,
//   };

//   const network = await gateway.getNetwork(channelName);
//   t.ok(network, "network truthy OK");

//   const channel = await network.getChannel();
//   t.ok(channel, "channel truthy OK");

//   const proposal = await channel.generateUnsignedProposal(
//     transactionProposal,
//     organisation,
//     signingUser.certificate,
//     true,
//   );

//   const proposalBytes = (proposal as any).proposal.toBuffer(); // the proposal comes from step 1

//   const sig = Utils.hashAndSignProposal(proposalBytes, signingUser.privateKey);
//   const signature = Utils.preventMalleability(sig);

//   const signedProposal = {
//     signature,
//     proposal_bytes: proposalBytes,
//   };

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

//   // Generate Signed Transaction
//   const commitReq = {
//     proposalResponses: (proposalResponses as unknown) as ProposalResponse[],
//     proposal: (proposal as any).proposal,
//   };

//   const commitProposal = await channel.generateUnsignedTransaction(commitReq);

//   const data: ByteBuffer = commitProposal.data;

//   const signedCommitProposal = Utils.hashAndSignProposal(
//     data.toBuffer(),
//     signingUser.privateKey,
//   );
//   const malleableSig = Utils.preventMalleability(signedCommitProposal);

//   const signedTransaction = {
//     signedTransaction: malleableSig,
//     request: commitReq,
//     signedProposal: signedProposal as any,
//   } as any;

//   const signedTransactionRequest: SendSignedProposalRequest = {
//     channelName,
//     data: signedTransaction,
//     signingCredential: {
//       keychainId,
//       keychainRef: serviceUserId,
//       type: FabricSigningCredentialType.None,
//     },
//   };

//   const responses = await plugin.sendSignedTransaction(
//     signedTransactionRequest,
//   );

//   t.ok(responses, "sendSignedTransaction response OK");
//   t.end();
// });

// test("AFTER " + testCase, async (t: Test) => {
//   const pruning = pruneDockerAllIfGithubAction({ logLevel });
//   await t.doesNotReject(pruning, "Pruning didn't throw OK");
//   t.end();
// });

import { buildPoseidon } from "circomlibjs";
import { verifyDKIMSignature } from "@zk-email/helpers/dist/dkim";
import { generateDiscordVerifierCircuitInputs } from "../helpers";
import { bigIntToChunkedBytes, bytesToBigInt, packedNBytesToString } from "@zk-email/helpers/dist/binaryFormat";

const path = require("path");
const fs = require("fs");
const wasm_tester = require("circom_tester").wasm;


describe("Discord email test", function () {
  jest.setTimeout(10 * 60 * 1000); // 10 minutes

  let rawEmail: Buffer;
  let circuit: any;
  const ethAddress = "0x7C2b36D164A50765c1C16aE4542a4903e6A1f0BA";

  beforeAll(async () => {
    rawEmail = fs.readFileSync(
      path.join(__dirname, "./emls/discord-test-x.eml"),
      "utf8"
    );

    circuit = await wasm_tester(path.join(__dirname, "../src/discord.circom"), {
      // NOTE: We are running tests against pre-compiled circuit in the below path
      // You need to manually compile when changes are made to circuit if `recompile` is set to `false`.
      recompile: true,
      output: path.join(__dirname, "../build/discord"),
      include: [path.join(__dirname, "../node_modules"), path.join(__dirname, "../../../node_modules")],
    });
  });

  it("should verify discord email", async function () {
    const discordVerifierInputs = await generateDiscordVerifierCircuitInputs(rawEmail, ethAddress);
    const witness = await circuit.calculateWitness(discordVerifierInputs);
    await circuit.checkConstraints(witness);

    // Calculate DKIM pubkey hash to verify its same as the one from circuit output
    // We input pubkey as 121 * 17 chunk, but the circuit convert it to 242 * 9 chunk for hashing
    // https://zkrepl.dev/?gist=43ce7dce2466c63812f6efec5b13aa73 - This can be used to get pubkey hash from 121 * 17 chunk
    const dkimResult = await verifyDKIMSignature(rawEmail, "discord.com");
    const poseidon = await buildPoseidon();
    const pubkeyChunked = bigIntToChunkedBytes(dkimResult.publicKey, 242, 9);
    const hash = poseidon(pubkeyChunked);


    // Assert pubkey hash
    expect(witness[1]).toEqual(poseidon.F.toObject(hash));

    // Verify the username is correctly extracted and packed form email body
    const usernameInEmailBytes = new TextEncoder().encode("zktestemail").reverse(); // Circuit pack in reverse order
    expect(witness[2]).toEqual(bytesToBigInt(usernameInEmailBytes));

    // Check address public input
    expect(witness[3]).toEqual(BigInt(ethAddress));
  });

  it("should fail if the discordUsernameIndex is invalid", async function () {
    const discordVerifierInputs = await generateDiscordVerifierCircuitInputs(rawEmail, ethAddress);
    discordVerifierInputs.discordUsernameIndex = (Number((await discordVerifierInputs).discordUsernameIndex) + 1).toString();

    expect.assertions(1);
    try {
      const witness = await circuit.calculateWitness(discordVerifierInputs);
      await circuit.checkConstraints(witness);
    } catch (error) {
      expect((error as Error).message).toMatch("Assert Failed");
    }
  })
});

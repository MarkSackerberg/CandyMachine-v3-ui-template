import {
  DefaultCandyGuardSettings,
  Metaplex,
  PublicKey,
  CandyMachine,
  SolAmount,
  SplTokenAmount,
  FindNftsByOwnerOutput,
  getMerkleRoot,
  getMerkleTree,
} from "@metaplex-foundation/js";
import { allowLists } from "../allowlist";

const addressGateChecker = (metaplex: Metaplex, address: PublicKey) => {
  if (metaplex.identity().publicKey != address) {
    console.error(`addressGate: You are not allowed to mint`);
    return false;
  }
  return true;
};

const solBalanceChecker = (solBalance: Number, solAmount: SolAmount) => {
  const costInLamports = Number(solAmount.basisPoints.toString(10));
  if (costInLamports > solBalance) {
    console.error("freezeSolPayment/solPayment: Not enough SOL!");
    return false;
  }
  return true;
};

const tokenBalanceChecker = async (
  metaplex: Metaplex,
  tokenAmount: SplTokenAmount,
  tokenMint: PublicKey
) => {
  const ata = metaplex.tokens().pdas().associatedTokenAccount({
    mint: tokenMint,
    owner: metaplex.identity().publicKey,
  });

  const balance = await metaplex.connection.getTokenAccountBalance(ata);

  if (Number(balance.value) < Number(tokenAmount.basisPoints.toString(10))) {
    return false;
  }
  return true;
};

const mintLimitChecker = async (
  metaplex: Metaplex,
  candyMachine: CandyMachine,
  singleGuard: DefaultCandyGuardSettings
) => {
  if (!singleGuard.mintLimit || !candyMachine.candyGuard) {
    return;
  }
  const mintLimitCounter = metaplex.candyMachines().pdas().mintLimitCounter({
    id: singleGuard.mintLimit.id,
    user: metaplex.identity().publicKey,
    candyMachine: candyMachine.address,
    candyGuard: candyMachine.candyGuard.address,
  });

  const mintedAmountBuffer = await metaplex.connection.getAccountInfo(
    mintLimitCounter,
    "processed"
  );

  let mintedAmount: Number = 0;
  if (mintedAmountBuffer != null) {
    mintedAmount = mintedAmountBuffer.data.readUintLE(0, 1);
  }

  if (mintedAmount >= singleGuard.mintLimit.limit) {
    console.error("mintLimit: mintLimit reached!");
    return false;
  }
  return true;
};

const ownedNftChecker = async (
  ownedNfts: FindNftsByOwnerOutput,
  requiredCollection: PublicKey
) => {
  const nftsInCollection = ownedNfts.filter((obj) => {
    return (
      obj.collection?.address.toBase58() === requiredCollection.toBase58() &&
      obj.collection?.verified === true
    );
  });
  if (nftsInCollection.length < 1) {
    console.error("nftBurn: The user has no NFT to pay with!");
    return false;
  } else {
    return true;
  }
};

const allowlistChecker = (
  allowLists: Map<string, string[]>,
  metaplex: Metaplex,
  guardlabel: string
) => {
  if (!allowLists.has(guardlabel)) {
    console.error(`Guard ${guardlabel}; allowlist missing in template`);
    return false;
  }
  if (
    !allowLists
      .get(guardlabel)
      ?.includes(metaplex.identity().publicKey.toBase58())
  ) {
    console.error(`Guard ${guardlabel}; allowlist wallet not allowlisted`);
    return false;
  }
  return true;
};

const getSolanaTime = async (metaplex: Metaplex) => {
  const slot = await metaplex.connection.getSlot();
  let solanaTime = await metaplex.connection.getBlockTime(slot);

  if (!solanaTime) solanaTime = 0;
  return solanaTime;
};

const checkDateRequired = (
  guards: { label: string; guards: DefaultCandyGuardSettings }[]
) => {
  for (const guard of guards){
    if (guard.guards.startDate || guard.guards.endDate) {
      return true;
    }
  };

  return false;
};

const checkSolBalanceRequired = (
  guards: { label: string; guards: DefaultCandyGuardSettings }[]
) => {
  let solBalanceRequired: boolean = false;
  guards.forEach((guard) => {
    if (guard.guards.freezeSolPayment || guard.guards.solPayment) {
      solBalanceRequired = true;
    }
  });

  return solBalanceRequired;
};

const checkNftsRequired = (
  guards: { label: string; guards: DefaultCandyGuardSettings }[]
) => {
  let nftBalanceRequired: boolean = false;
  guards.forEach((guard) => {
    if (
      guard.guards.nftBurn ||
      guard.guards.nftGate ||
      guard.guards.nftPayment
    ) {
      nftBalanceRequired = true;
    }
  });

  return nftBalanceRequired;
};

export interface GuardReturn {
  label: string;
  allowed: boolean;
}

export const guardChecker = async (
  metaplex: Metaplex,
  candyMachine: CandyMachine
) => {
  let guardReturn: GuardReturn[] = [];
  let ownedNfts: FindNftsByOwnerOutput | undefined;
  if (!candyMachine.candyGuard) {
    guardReturn.push({ label: "default", allowed: false });
    return { guardReturn, ownedNfts };
  }

  let guardsToCheck: { label: string; guards: DefaultCandyGuardSettings }[] =
    candyMachine.candyGuard.groups;
  guardsToCheck.push({
    label: "default",
    guards: candyMachine.candyGuard.guards,
  });

  //no wallet connected. return dummies
  const dummyPublicKey = "11111111111111111111111111111111";
  if (metaplex.identity().publicKey.toBase58() === dummyPublicKey) {
    for (const eachGuard of guardsToCheck) {
      guardReturn.push({ label: eachGuard.label, allowed: false });
    }
    console.log("No wallet connected - returning dummy buttons");
    return { guardReturn, ownedNfts };
  }

  // get as much required data upfront as possible
  let solanaTime = 0;
  if (checkDateRequired(guardsToCheck)) {
    solanaTime = await getSolanaTime(metaplex);
  }

  let solBalance = 0;
  if (checkSolBalanceRequired(guardsToCheck)) {
    solBalance = await metaplex.connection.getBalance(
      metaplex.identity().publicKey
    );
  }

  if (checkNftsRequired(guardsToCheck)) {
    ownedNfts = await metaplex
      .nfts()
      .findAllByOwner({ owner: metaplex.identity().publicKey });
  }

  for (const eachGuard of guardsToCheck) {
    const singleGuard = eachGuard.guards;
    if (singleGuard.addressGate != null) {
      if (!addressGateChecker(metaplex, singleGuard.addressGate.address)) {
        guardReturn.push({ label: eachGuard.label, allowed: false });
        continue;
      }
    }

    //generate and print merkleRoot in case the guardlabel is present in allowlist.tsx but not assigned
    if (
      metaplex.identity().publicKey === candyMachine.authorityAddress &&
      !singleGuard.allowList
    ) {
      const allowlist = allowLists.get(eachGuard.label);
      console.log(allowlist);
      if (allowlist) {
        console.log("add this merkleRoot to your candy guard config!");
        //@ts-ignore
        console.log(getMerkleRoot(allowlist).toString("hex"));
      }
    }

    if (singleGuard.allowList) {
      if (!allowlistChecker(allowLists, metaplex, eachGuard.label)) {
        console.error(`wallet not allowlisted!`);
        guardReturn.push({ label: eachGuard.label, allowed: false });
        continue;
      }
    }

    if (singleGuard.endDate) {
      if (solanaTime > Number(singleGuard.endDate.date.toString(10)))
        guardReturn.push({ label: eachGuard.label, allowed: false });
      console.error("Guard ${eachGuard.label}; endDate: reached!");
      continue;
    }

    if (singleGuard.freezeSolPayment) {
      if (!solBalanceChecker(solBalance, singleGuard.freezeSolPayment.amount)) {
        guardReturn.push({ label: eachGuard.label, allowed: false });
        console.error(
          `Guard ${eachGuard.label}; freezeSolPayment: not enough SOL`
        );
        continue;
      }
    }

    if (singleGuard.mintLimit) {
      if (!mintLimitChecker(metaplex, candyMachine, singleGuard)) {
        guardReturn.push({ label: eachGuard.label, allowed: false });
        continue;
      }
    }

    if (singleGuard.freezeTokenPayment) {
      if (
        !tokenBalanceChecker(
          metaplex,
          singleGuard.freezeTokenPayment.amount,
          singleGuard.freezeTokenPayment.mint
        )
      ) {
        guardReturn.push({ label: eachGuard.label, allowed: false });
        continue;
      }
    }

    if (singleGuard.nftBurn) {
      //@ts-ignore
      if (!ownedNftChecker(ownedNfts, singleGuard.nftBurn.requiredCollection)) {
        guardReturn.push({ label: eachGuard.label, allowed: false });
        continue;
      }
    }

    if (singleGuard.nftGate) {
      //@ts-ignore
      if (!ownedNftChecker(ownedNfts, singleGuard.nftGate.requiredCollection)) {
        guardReturn.push({ label: eachGuard.label, allowed: false });
        continue;
      }
    }

    if (singleGuard.nftPayment) {
      if (
        //@ts-ignore
        !ownedNftChecker(ownedNfts, singleGuard.nftPayment.requiredCollection)
      ) {
        guardReturn.push({ label: eachGuard.label, allowed: false });
        continue;
      }
    }

    if (singleGuard.redeemedAmount) {
      if (singleGuard.redeemedAmount.maximum >= candyMachine.itemsMinted) {
        guardReturn.push({ label: eachGuard.label, allowed: false });
        continue;
      }
    }

    if (singleGuard.solPayment) {
      if (!solBalanceChecker(solBalance, singleGuard.solPayment.amount)) {
        guardReturn.push({ label: eachGuard.label, allowed: false });
        continue;
      }
    }

    if (singleGuard.startDate) {
      if (solanaTime < Number(singleGuard.startDate.date.toString(10))) {
        console.error(`${eachGuard.label} guard not live!`);
        guardReturn.push({ label: eachGuard.label, allowed: false });
        continue;
      }
    }

    if (singleGuard.tokenBurn) {
      if (
        !tokenBalanceChecker(
          metaplex,
          singleGuard.tokenBurn.amount,
          singleGuard.tokenBurn.mint
        )
      ) {
        guardReturn.push({ label: eachGuard.label, allowed: false });
        continue;
      }
    }

    if (singleGuard.tokenGate) {
      if (
        !tokenBalanceChecker(
          metaplex,
          singleGuard.tokenGate.amount,
          singleGuard.tokenGate.mint
        )
      ) {
        guardReturn.push({ label: eachGuard.label, allowed: false });
        continue;
      }
    }

    if (singleGuard.tokenPayment) {
      if (
        !tokenBalanceChecker(
          metaplex,
          singleGuard.tokenPayment.amount,
          singleGuard.tokenPayment.mint
        )
      ) {
        guardReturn.push({ label: eachGuard.label, allowed: false });
        continue;
      }
    }

    guardReturn.push({ label: eachGuard.label, allowed: true });
  }
  return { guardReturn, ownedNfts };
};

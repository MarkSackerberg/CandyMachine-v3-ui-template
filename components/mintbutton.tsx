import {
  CandyMachine,
  DefaultCandyGuardSettings,
  Metaplex,
  getMerkleProof,
  FindNftsByOwnerOutput,
  DefaultCandyGuardMintSettings,
  CandyGuardsSettings,
} from "@metaplex-foundation/js";
import { Button, Card, Text, Row } from "@nextui-org/react";
import { GuardReturn } from "../utils/checker";
import { allowLists } from "../allowlist";
import { mintText } from "../mintText";

interface GuardList extends GuardReturn {
  mintText: string;
  buttonLabel: string;
}

const chooseGuardToUse = (
  guard: GuardReturn,
  candyMachine: CandyMachine<DefaultCandyGuardSettings>
) => {
  let guardGroup = candyMachine.candyGuard?.groups.find(
    (item) => item.label === guard.label
  );
  if (guardGroup) {
    return guardGroup;
  }

  if (candyMachine.candyGuard != null){
    return {
      label: "default",
      guards: candyMachine.candyGuard.guards,
    };
  }

  return {
    label: "default",
    guards: undefined
  };
}

const callGuardRoutes = async (
  metaplex: Metaplex,
  candyMachine: CandyMachine<DefaultCandyGuardSettings>,
  guardToUse: {
    label: string;
    guards: DefaultCandyGuardSettings;
},
) => {
  if (guardToUse.guards.allowList) {
    const allowlist = allowLists.get(guardToUse.label);
    if (!allowlist) {
      console.error("allowlist for this guard not defined in allowlist.tsx");
      return;
    }
    await metaplex.candyMachines().callGuardRoute({
      candyMachine,
      guard: "allowList",
      group: guardToUse.label,
      settings: {
        path: "proof",
        merkleProof: getMerkleProof(
          allowlist,
          metaplex.identity().publicKey.toBase58()
        ),
      },
    });
  }
}

const mintClick = async (
  guard: GuardReturn,
  candyMachine: CandyMachine<DefaultCandyGuardSettings>,
  metaplex: Metaplex,
  ownedNfts: FindNftsByOwnerOutput | undefined
) => {
  candyMachine = await metaplex
  .candyMachines()
  .findByAddress({ address: candyMachine.address });

  const guardToUse = chooseGuardToUse(guard, candyMachine);
  if (!guardToUse.guards) {
    console.error("no guard defined!")  
    return
  }

  await callGuardRoutes(metaplex, candyMachine, guardToUse);

  const gateNft = ownedNfts?.filter((obj) => {
    return (
      obj.collection?.address.toBase58() ===
        guardToUse?.guards.nftGate?.requiredCollection.toBase58() &&
      obj.collection?.verified === true
    );
  })[0];
  let guardObject: Partial<DefaultCandyGuardMintSettings> = {};
  if (gateNft) {
    guardObject.nftGate = { mint: gateNft.address };
  }

  // TODO: have the user choose which NFT to pay/burn?

  const { nft } = await metaplex.candyMachines().mint({
    candyMachine: candyMachine,
    collectionUpdateAuthority: candyMachine.authorityAddress,
    group: guardToUse.label === "default" ? null : guardToUse.label,
    guards: guardObject,
  });
};

type Props = {
  guardList: GuardReturn[];
  candyMachine: CandyMachine | undefined;
  metaplex: Metaplex;
  ownedNfts: FindNftsByOwnerOutput | undefined;
};

export function ButtonList({
  guardList,
  candyMachine,
  metaplex,
  ownedNfts,
}: Props): JSX.Element {
  if (!candyMachine) {
    return <></>;
  }

  // Guard "default" can only be used to mint in case no other guard exists
  let filteredGuardlist = guardList;
  if (guardList.length > 1) {
    filteredGuardlist = guardList.filter((elem) => elem.label != "default");
  }
  let buttonGuardList = [];
  for (const guard of filteredGuardlist) {
    const text = mintText.find((elem) => elem.label === guard.label);

    let buttonElement: GuardList = {
      label: guard ? guard.label : "default",
      allowed: guard.allowed,
      mintText: text ? text.mintText : "definition missing in mintText.tsx",
      buttonLabel: text
        ? text.buttonLabel
        : "definition missing in mintText.tsx",
    };
    buttonGuardList.push(buttonElement);
  }
  //TODO: Placeholder for start + end time?
  const listItems = buttonGuardList.map((buttonGuard) => (
    <>
      <Row>
        <Text>{buttonGuard.mintText}</Text>
        <Button
          bordered
          color="gradient"
          auto
          key={buttonGuard.label}
          onPress={() =>
            mintClick(buttonGuard, candyMachine, metaplex, ownedNfts)
          }
          disabled={!buttonGuard.allowed}
          size="sm"
        >
          {buttonGuard.buttonLabel}
        </Button>
      </Row>
      <Card.Divider></Card.Divider>
    </>
  ));

  return <>{listItems}</>;
}

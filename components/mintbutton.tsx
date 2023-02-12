import {
  CandyMachine,
  DefaultCandyGuardSettings,
  Metaplex,
  getMerkleProof,
  PublicKey,
} from "@metaplex-foundation/js";
import { Button, Card, Text, Row } from "@nextui-org/react";
import { GuardReturn } from "../utils/checker";
import { allowLists } from "../allowlist";
import { mintText } from "../mintText";

interface GuardList extends GuardReturn {
  mintText: string;
  buttonLabel: string;
}

const mintClick = useCallback(async (
  guard: GuardReturn,
  candyMachine: CandyMachine<DefaultCandyGuardSettings>,
  metaplex: Metaplex
) => {
  let guardToUse: {
    label: string;
    guards: DefaultCandyGuardSettings;
} | undefined = candyMachine.candyGuard?.groups.find(
    (item) => item.label === guard.label
  );

  // not found, use default!
  if (!guardToUse) {
    if (!candyMachine.candyGuard) {
      console.error("this should crash before. no guard defined.");
      return;
    }
    guardToUse = {
      label: "default",
      guards: candyMachine.candyGuard.guards
    }
  }
  candyMachine = await metaplex.candyMachines().findByAddress({address: candyMachine.address})

  if (guardToUse.guards.allowList) {
    const allowlist = allowLists.get(guard.label);
    if (!allowlist) {
      console.error("allowlist for this guard not defined in allowlist.tsx");
      return;
    }
    await metaplex.candyMachines().callGuardRoute({
      candyMachine,
      guard: 'allowList',
      group: guardToUse.label,
      settings: {
        path: 'proof',
        merkleProof: getMerkleProof(
          allowlist,
          metaplex.identity().publicKey.toBuffer()
        ),
      },
    });
  }

  // TODO: have the user choose which NFT to pay/burn?
  console.log(candyMachine.candyGuard)
  const { nft } = await metaplex.candyMachines().mint({
    candyMachine: candyMachine,
    collectionUpdateAuthority: candyMachine.authorityAddress,
    group: (guardToUse.label === "default") ? null : guardToUse.label ,
/*     guards: {
      nftBurn: {
        mint: nftToBurn.address,
      },
      nftGate: {
        mint: nftFromRequiredCollection.address,
      },
      nftPayment: {
        mint: nftToPayWith.address,
      },
    }, */
  });
}, []);

type Props = {
  guardList: GuardReturn[];
  candyMachine: CandyMachine<DefaultCandyGuardSettings> | undefined;
  metaplex: Metaplex;
};

export function ButtonList({
  guardList,
  candyMachine,
  metaplex,
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
  console.log(buttonGuardList.length)
  const listItems = buttonGuardList.map((buttonGuard) => (
    <>
      <Row>
        <Text>{buttonGuard.mintText}</Text>
        <Button
          bordered
          color="gradient"
          auto
          key={buttonGuard.label}
          onPress={() => mintClick(buttonGuard, candyMachine, metaplex)}
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

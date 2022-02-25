import {
  Box,
  Center, Container, Heading,
  Spinner,
  useColorModeValue,
  VStack
} from "@chakra-ui/react";
import { GatewayProvider } from '@civic/solana-gateway-react';
import * as anchor from '@project-serum/anchor';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { Branding, IMintArgs, LbcInfo, MintButton, useLivePrice, WalletModalButton } from "@strata-foundation/marketplace-ui";
import {
  Notification, useTokenBondingFromMint
} from "@strata-foundation/react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  CandyMachineAccount,
  CANDY_MACHINE_PROGRAM,
  getCandyMachineState,
  mintOneToken
} from './candy-machine';
import { MintedNftNotification } from "./MintedNftNotification";
import { getAtaForMint, toDate } from './utils';
export interface HomeProps {
  candyMachineId?: anchor.web3.PublicKey;
  txTimeout: number;
  rpcHost: string;
}

const Home = (props: HomeProps) => {
  const { connection } = useConnection();
  const [candyMachine, setCandyMachine] = useState<CandyMachineAccount>();
  const [isActive, setIsActive] = useState(false);
  const [endDate, setEndDate] = useState<Date>();
  const [itemsRemaining, setItemsRemaining] = useState<number>();
  const [isWhitelistUser, setIsWhitelistUser] = useState(false);
  const [isPresale, setIsPresale] = useState(false);
  const [discountPrice, setDiscountPrice] = useState<anchor.BN>();
  const mintKey = candyMachine?.state.tokenMint;
  const { info: tokenBonding, loading } = useTokenBondingFromMint(mintKey);
  const { price } = useLivePrice(tokenBonding?.publicKey);

  const rpcUrl = props.rpcHost;
  const wallet = useWallet();

  const anchorWallet = useMemo(() => {
    if (
      !wallet ||
      !wallet.publicKey ||
      !wallet.signAllTransactions ||
      !wallet.signTransaction
    ) {
      return;
    }

    return {
      publicKey: wallet.publicKey,
      signAllTransactions: wallet.signAllTransactions,
      signTransaction: wallet.signTransaction,
    } as anchor.Wallet;
  }, [wallet]);

  const refreshCandyMachineState = useCallback(async () => {
    if (!anchorWallet) {
      return;
    }

    if (props.candyMachineId) {
      try {
        const cndy = await getCandyMachineState(
          anchorWallet,
          props.candyMachineId,
          connection,
        );
        let active =
          cndy?.state.goLiveDate?.toNumber() < new Date().getTime() / 1000;
        let presale = false;
        // whitelist mint?
        if (cndy?.state.whitelistMintSettings) {
          // is it a presale mint?
          if (
            cndy.state.whitelistMintSettings.presale &&
            (!cndy.state.goLiveDate ||
              cndy.state.goLiveDate.toNumber() > new Date().getTime() / 1000)
          ) {
            presale = true;
          }
          // is there a discount?
          if (cndy.state.whitelistMintSettings.discountPrice) {
            setDiscountPrice(cndy.state.whitelistMintSettings.discountPrice);
          } else {
            setDiscountPrice(undefined);
            // when presale=false and discountPrice=null, mint is restricted
            // to whitelist users only
            if (!cndy.state.whitelistMintSettings.presale) {
              cndy.state.isWhitelistOnly = true;
            }
          }
          // retrieves the whitelist token
          const mint = new anchor.web3.PublicKey(
            cndy.state.whitelistMintSettings.mint,
          );
          const token = (await getAtaForMint(mint, anchorWallet.publicKey))[0];

          try {
            const balance = await connection.getTokenAccountBalance(
              token,
            );
            let valid = parseInt(balance.value.amount) > 0;
            // only whitelist the user if the balance > 0
            setIsWhitelistUser(valid);
            active = (presale && valid) || active;
          } catch (e) {
            setIsWhitelistUser(false);
            // no whitelist user, no mint
            if (cndy.state.isWhitelistOnly) {
              active = false;
            }
            console.log('There was a problem fetching whitelist token balance');
            console.log(e);
          }
        }
        // datetime to stop the mint?
        if (cndy?.state.endSettings?.endSettingType.date) {
          setEndDate(toDate(cndy.state.endSettings.number));
          if (
            cndy.state.endSettings.number.toNumber() <
            new Date().getTime() / 1000
          ) {
            active = false;
          }
        }
        // amount to stop the mint?
        if (cndy?.state.endSettings?.endSettingType.amount) {
          let limit = Math.min(
            cndy.state.endSettings.number.toNumber(),
            cndy.state.itemsAvailable,
          );
          if (cndy.state.itemsRedeemed < limit) {
            setItemsRemaining(limit - cndy.state.itemsRedeemed);
          } else {
            setItemsRemaining(0);
            cndy.state.isSoldOut = true;
          }
        } else {
          setItemsRemaining(cndy.state.itemsRemaining);
        }

        if (cndy.state.isSoldOut) {
          active = false;
        }

        setIsActive((cndy.state.isActive = active));
        setIsPresale((cndy.state.isPresale = presale));
        setCandyMachine(cndy);
      } catch (e) {
        console.log('There was a problem fetching Candy Machine state');
        console.log(e);
      }
    }
  }, [anchorWallet, props.candyMachineId, connection]);

  async function buy(): Promise<void> {

  }
  const onMint = async (args: IMintArgs) => {
    try {
      document.getElementById("#identity")?.click();
      if (wallet.connected && candyMachine?.program && wallet.publicKey) {
        const mint = await mintOneToken(candyMachine, wallet.publicKey, args)
        toast.custom(
          (t) => (
            <MintedNftNotification
              mint={mint}
              onDismiss={() => toast.dismiss(t.id)}
            />
          ),
          {
            duration: Infinity,
          }
        );
      }
    } catch (error: any) {
      let message = error.msg || error.toString() || "Minting failed! Please try again!";
      if (!error.msg) {
        if (!error.message) {
          message = "Transaction Timeout! Please try again.";
        } else if (error.message.indexOf("0x137") != -1) {
          message = `SOLD OUT!`;
        } else if (error.message.indexOf("0x135") != -1) {
          message = `Insufficient funds to mint. Please fund your wallet.`;
        }
      } else {
        if (error.code === 311) {
          message = `SOLD OUT!`;
          window.location.reload();
        } else if (error.code === 312) {
          message = `Minting period hasn't started yet.`;
        } else {
          message = error.toString();
        }
      }

      toast.custom((t) => (
        <Notification
          show={t.visible}
          type="error"
          heading="Transaction Failed"
          message={message}
          onDismiss={() => toast.dismiss(t.id)}
        />
      ));
      // updates the candy machine state to reflect the lastest
      // information on chain
      refreshCandyMachineState();
    }
  };

  const toggleMintButton = () => {
    let active = !isActive || isPresale;

    if (active) {
      if (candyMachine!.state.isWhitelistOnly && !isWhitelistUser) {
        active = false;
      }
      if (endDate && Date.now() >= endDate.getTime()) {
        active = false;
      }
    }

    if (
      isPresale &&
      candyMachine!.state.goLiveDate &&
      candyMachine!.state.goLiveDate.toNumber() <= new Date().getTime() / 1000
    ) {
      setIsPresale((candyMachine!.state.isPresale = false));
    }

    setIsActive((candyMachine!.state.isActive = active));
  };

  useEffect(() => {
    refreshCandyMachineState();
  }, [
    anchorWallet,
    props.candyMachineId,
    connection,
    refreshCandyMachineState,
  ]);

  return (
    <Box
      color={useColorModeValue("black", "white")}
      w="full"
      backgroundColor="black.500"
      height="100vh"
      overflow="auto"
      paddingBottom="200px"
    >
      {wallet.connected && (
        <Container mt={"35px"} justifyItems="stretch" maxW="460px">
          <Heading mb={2} fontSize="24px" fontWeight={600}>
            Mint
          </Heading>
          <Box
            zIndex={1}
            shadow="xl"
            rounded="lg"
            p="16px"
            pb="29px"
            minH="300px"
            bg="black.300"
          >
            {loading && (
              <Center>
                <Spinner />
              </Center>
            )}
            {!loading && tokenBonding && (
              <VStack align="stretch" spacing={8}>
                <LbcInfo
                  price={price}
                  tokenBondingKey={tokenBonding.publicKey}
                />

                {candyMachine?.state.isActive &&
                candyMachine?.state.gatekeeper &&
                wallet.publicKey &&
                wallet.signTransaction ? (
                  <GatewayProvider
                    wallet={{
                      publicKey:
                        wallet.publicKey ||
                        new PublicKey(CANDY_MACHINE_PROGRAM),
                      //@ts-ignore
                      signTransaction: wallet.signTransaction,
                    }}
                    gatekeeperNetwork={
                      candyMachine?.state?.gatekeeper?.gatekeeperNetwork
                    }
                    clusterUrl={rpcUrl}
                    options={{ autoShowModal: false }}
                  >
                    <MintButton
                      price={price}
                      onMint={onMint}
                      tokenBondingKey={tokenBonding.publicKey}
                      isDisabled={!isActive && (!isPresale || !isWhitelistUser)}
                      disabledText={`Mint launches ${getCountdownDate(
                        candyMachine
                      )?.toLocaleTimeString()}`}
                    />
                  </GatewayProvider>
                ) : (
                  <MintButton
                    price={price}
                    onMint={onMint}
                    tokenBondingKey={tokenBonding.publicKey}
                    isDisabled={!isActive && (!isPresale || !isWhitelistUser)}
                    disabledText={candyMachine && `Mint launches ${getCountdownDate(
                      candyMachine
                    )?.toLocaleTimeString()}`}
                  />
                )}
                <Branding />
              </VStack>
            )}
          </Box>
        </Container>
      )}
      {!wallet.connected && (
        <WalletModalButton>Connect Wallet</WalletModalButton>
      )}
    </Box>
  );
};

const getCountdownDate = (
  candyMachine: CandyMachineAccount,
): Date | undefined => {
  if (
    candyMachine.state.isActive &&
    candyMachine.state.endSettings?.endSettingType.date
  ) {
    return toDate(candyMachine.state.endSettings.number);
  }

  return toDate(
    candyMachine.state.goLiveDate
      ? candyMachine.state.goLiveDate
      : candyMachine.state.isPresale
      ? new anchor.BN(new Date().getTime() / 1000)
      : undefined,
  );
};

export default Home;

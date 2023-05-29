import {
  Heading,
  Modal,
  ModalContent,
  ModalOverlay,
  Text,
} from '@chakra-ui/react'
import { noop } from 'lodash-es'

export function IntroModal() {
  return (
    <Modal
      size="lg"
      isOpen={true}
      onClose={noop}
      closeOnOverlayClick={false}
      closeOnEsc={false}
      isCentered
    >
      <ModalOverlay />
      <ModalContent
        p="8"
        display="flex"
        alignItems="center"
        justifyContent="center"
      >
        <Heading>Hey, welcome to Coalesce!</Heading>
        <Text mt="4">This is a very early development proof of concept. </Text>
        <Text mt="4">Please see the README for how to get started.</Text>
      </ModalContent>
    </Modal>
  )
}

import {
  Modal,
  ModalContent,
  ModalOverlay,
  Spinner,
  Text,
} from '@chakra-ui/react'
import { noop } from 'lodash-es'

export function LoadingCover() {
  return (
    <Modal
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
        <Spinner size="xl" />
        <Text mt="4">Loading audio...</Text>
        <Text mt="1" fontSize="xs">
          (this can take a while)
        </Text>
      </ModalContent>
    </Modal>
  )
}

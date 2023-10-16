import {
  Button,
  Collapse,
  Flex,
  FormControl,
  FormLabel,
  HStack,
  Icon,
  Input,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger,
  Switch,
  useClipboard,
  useToast,
} from '@chakra-ui/react'
import { Project } from '@shared/types'
import React, { useCallback, useMemo, useRef } from 'react'
import { MdSupervisorAccount } from 'react-icons/md'
import { useAPI } from './APIContext'

export function CollaborateButton({ project }: { project: Project }) {
  const { updateProject } = useAPI()
  const { guestEditKey } = project

  const guestEditURL = useMemo(() => {
    if (!guestEditKey) {
      return ''
    }
    const url = new URL(window.location.toString())
    url.searchParams.set('guestEditKey', guestEditKey)
    return url.toString()
  }, [guestEditKey])

  const toast = useToast()
  const { onCopy } = useClipboard(guestEditURL)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleInputClick = useCallback(() => {
    inputRef.current?.select()
    onCopy()
    toast({
      title: 'Guest editor link copied',
      status: 'success',
      position: 'top',
    })
  }, [onCopy])

  const handleSwitchChange = useCallback(
    (ev: React.ChangeEvent<HTMLInputElement>) => {
      updateProject(project.projectId, {
        guestEditKey: ev.target.checked ? 'new' : null,
      })
    },
    [project],
  )

  return (
    <Popover>
      <PopoverTrigger>
        <Button
          color={guestEditKey ? 'green.700' : 'black'}
          leftIcon={<Icon fontSize="2xl" as={MdSupervisorAccount} />}
        >
          Collaborate
        </Button>
      </PopoverTrigger>
      <PopoverContent p={2} boxShadow="lg">
        <PopoverArrow />
        <PopoverHeader fontWeight="bold" border="none">
          Invite collaborators
        </PopoverHeader>
        <PopoverBody>
          <Flex direction="column" alignItems="stretch">
            <HStack w="full">
              <FormControl display="flex">
                <FormLabel fontWeight="normal" flex="1">
                  Allow guests with link to edit
                </FormLabel>
                <Switch
                  isChecked={Boolean(guestEditKey)}
                  onChange={handleSwitchChange}
                />
              </FormControl>
            </HStack>
            <Collapse in={!!guestEditURL}>
              <Input
                ref={inputRef}
                disabled={!guestEditURL}
                value={guestEditURL}
                onClick={handleInputClick}
                variant="filled"
                p={2}
                mt={2}
              />
            </Collapse>
          </Flex>
        </PopoverBody>
      </PopoverContent>
    </Popover>
  )
}

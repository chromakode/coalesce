import { Box, BoxProps } from '@chakra-ui/react'
import { motion } from 'framer-motion'

const MotionBox =
  motion<Omit<BoxProps, 'transition' | 'onDragEnd' | 'style'>>(Box)

export default MotionBox
